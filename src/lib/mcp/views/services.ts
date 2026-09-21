import prisma from '@/lib/prisma';
import { getUniqueSlug, getViewUrl } from '@/utils/controllers/projects/views/viewsHelperAPIfunctions';
import { matchLabelIds, validateProjectAccess, validateProjectMemberIds } from '@/lib/mcp/tasks/services';
import { broadcastBoardChange } from '@/lib/realtime/server';
import { sanitizeBoardFilters } from '@/utils/helperFunctions/Views/BoardFilterSanitizer';
import { EmptySections, Prisma, SortingMode, SortingOrder, SubtaskSetting, ViewVisibility } from '@prisma/client';
import { DEFAULT_SUBTASK_SETTING, type TBoardSortingLevel } from '@/models/Views/model';
import { sanitizeSortingStack } from '@/utils/helperFunctions/Views/ViewsHelperFunctions';
import {
    acquireBoardFilterWriteLock,
    assertViewIsNotManagedSmartSplit,
    validateBoardFilterLabelReferences,
    withBoardFilterWriteLock,
} from '@/utils/controllers/projects/views/boardFilterWriteLock';
import { canonicalBoardColumns, normalizeNativeBoardFilters } from './nativeBoardSettings';

export type CreateViewFilters = {
    label_names?: string[];
    assignee_ids?: Array<number | string>;
    match?: 'ALL' | 'ANY';
};

export type CreateViewInput = {
    projectId: number;
    userId: number;
    title: string;
    visibility?: ViewVisibility;
    filters?: CreateViewFilters;
    board_filters?: unknown;
    visible_section_ids?: number[];
    sorting_mode?: SortingMode;
    sorting_order?: SortingOrder;
    sorting_stack?: TBoardSortingLevel[];
    subtask_setting?: SubtaskSetting;
    board_empty_sections?: EmptySections;
    setAsDefault?: boolean;
};

function assertEmptySections(value: unknown): asserts value is EmptySections | undefined {
    if (value !== undefined && value !== EmptySections.Show && value !== EmptySections.Hidden) {
        throw new Error('board_empty_sections must be Show or Hidden');
    }
}

// Board filters are persisted without their `condition` function; the client
// re-attaches one by `type` (see defaultConditions in FilterHelperFunctions).
type BoardFilterEntry = { type: string; searchPayload: unknown[] };

async function buildLabelsFilterEntry(
    projectId: number,
    labelNames?: string[]
): Promise<BoardFilterEntry | undefined> {
    if (!labelNames?.length) return undefined;

    const projectLabels = await prisma.label.findMany({
        where: { projectId },
        select: { id: true, value: true },
    });
    const { ids, unresolved } = matchLabelIds(projectLabels, labelNames);
    if (unresolved.length) {
        throw new Error(
            `Label(s) not found in project: ${unresolved.join(', ')}`
        );
    }
    return {
        type: 'Labels',
        searchPayload: ids.map((id) => ({ id })),
    };
}

async function buildAssigneesFilterEntry(
    projectId: number,
    assigneeIds?: Array<number | string>
): Promise<BoardFilterEntry | undefined> {
    if (!assigneeIds?.length) return undefined;

    const uniqueAssigneeIds = [...new Set(assigneeIds)];
    const userIds = uniqueAssigneeIds.filter(
        (assigneeId): assigneeId is number => typeof assigneeId === 'number'
    );
    const agentIds = uniqueAssigneeIds.filter(
        (assigneeId): assigneeId is string => typeof assigneeId === 'string'
    );

    const { invalidIds, error } = await validateProjectMemberIds(projectId, userIds);
    if (error) throw new Error(error.message);
    if (invalidIds.length) {
        throw new Error(`assignee ${invalidIds[0]} is neither a project member nor an agent on this board`);
    }

    const members = await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, uid: true, displayName: true, photoURL: true },
    });
    const membersById = new Map(members.map((member) => [member.id, member]));
    const missingUserId = userIds.find((userId) => !membersById.has(userId));
    if (missingUserId !== undefined) {
        throw new Error(`assignee ${missingUserId} is neither a project member nor an agent on this board`);
    }

    const agents = await prisma.agent.findMany({
        where: {
            id: { in: agentIds },
            revokedAt: null,
            members: { some: { projectId } },
        },
        select: { id: true, displayName: true },
    });
    const agentsById = new Map(agents.map((agent) => [agent.id, agent]));
    const missingAgentId = agentIds.find((agentId) => !agentsById.has(agentId));
    if (missingAgentId !== undefined) {
        throw new Error(`assignee ${missingAgentId} is neither a project member nor an agent on this board`);
    }

    return {
        type: 'Assignees',
        searchPayload: uniqueAssigneeIds.map((assigneeId) =>
            typeof assigneeId === 'number'
                ? membersById.get(assigneeId)!
                : agentsById.get(assigneeId)!
        ),
    };
}

async function buildValidatedNativeBoardFilters(projectId: number, value: unknown) {
    const normalized = normalizeNativeBoardFilters(value);
    const entries = normalized.addedFilters as Array<{
        type: string;
        match?: 'ALL' | 'ANY';
        searchPayload: Array<{ id?: number | string }>;
    }>;
    const assignees = entries.find((entry) => entry.type === 'Assignees');
    if (!assignees) return normalized;

    const canonical = await buildAssigneesFilterEntry(
        projectId,
        assignees.searchPayload.map((item) => item.id!).filter((id) => id !== undefined)
    );
    return {
        ...normalized,
        addedFilters: canonical
            ? entries.map((entry) =>
                  entry.type === 'Assignees'
                      ? { ...canonical, ...(assignees.match ? { match: assignees.match } : {}) }
                      : entry
              )
            : entries.filter((entry) => entry.type !== 'Assignees'),
    };
}

async function buildBoardFilters(projectId: number, filters?: CreateViewFilters) {
    const addedFilters: BoardFilterEntry[] = [];

    const labelsEntry = await buildLabelsFilterEntry(projectId, filters?.label_names);
    if (labelsEntry) addedFilters.push(labelsEntry);

    const assigneesEntry = await buildAssigneesFilterEntry(projectId, filters?.assignee_ids);
    if (assigneesEntry) addedFilters.push(assigneesEntry);

    return {
        matchFilters: filters?.match ?? 'ANY',
        addedFilters,
    };
}

export async function createView(input: CreateViewInput) {
    const { projectId, userId, title } = input;
    assertEmptySections(input.board_empty_sections);

    const existing = await prisma.view.findFirst({
        where: { title, project_view: { projectId } },
        select: { id: true },
    });
    if (existing) {
        throw new Error(`A view titled "${title}" already exists on this board`);
    }

    const board_filters = input.board_filters === undefined
        ? sanitizeBoardFilters(await buildBoardFilters(projectId, input.filters))
        : await buildValidatedNativeBoardFilters(projectId, input.board_filters);
    const boardColumns = input.visible_section_ids === undefined
        ? undefined
        : await canonicalBoardColumns(projectId, input.visible_section_ids);
    const sortingMode = input.sorting_mode ?? 'Manual';
    const sortingStack = sanitizeSortingStack(input.sorting_stack, sortingMode);

    const project_view = await prisma.project_View.upsert({
        create: { projectId },
        update: {},
        where: { projectId },
    });

    // This helper acquires the board lock and validates every Labels id against
    // this project before the create callback can persist the view.
    const view = await withBoardFilterWriteLock(projectId, board_filters, (tx) => tx.view.create({
        data: {
            title,
            project_view_id: project_view.id,
            userId,
            visibility: input.visibility ?? 'Public',
            board_sorting_mode: sortingMode,
            board_sorting_order: input.sorting_order ?? 'Descending',
            board_sorting_stack: sortingStack as unknown as Prisma.InputJsonValue,
            board_subtask_setting: input.subtask_setting ?? DEFAULT_SUBTASK_SETTING,
            board_empty_sections: input.board_empty_sections ?? EmptySections.Show,
            board_filters: board_filters as unknown as Prisma.InputJsonValue,
            // Omitted native columns inherit the default view; supplied columns
            // intentionally freeze the caller's current visibility projection.
            board_columns_view: boardColumns as unknown as Prisma.InputJsonValue | undefined,
            lastUsedAt: new Date(),
        },
    }));

    const slug = await getUniqueSlug(project_view.id, title);
    if (slug) {
        await prisma.view.update({ where: { id: view.id }, data: { slug } });
    }

    if (input.setAsDefault) {
        await prisma.project_View.update({
            where: { projectId },
            data: { default_view_id: view.id },
        });
    }

    broadcastBoardChange(projectId, { originUserId: userId });

    return {
        id: view.id,
        title: view.title,
        slug,
        url: slug ? getViewUrl(projectId, slug) : null,
        visibility: view.visibility,
        projectId,
        filters: board_filters,
        sorting_mode: view.board_sorting_mode,
        sorting_order: view.board_sorting_order,
        sorting_stack: view.board_sorting_stack,
        board_columns_view: boardColumns,
        board_subtask_setting: view.board_subtask_setting,
        board_empty_sections: view.board_empty_sections,
        isDefault: Boolean(input.setAsDefault),
    };
}

export type UpdateViewInput = {
    viewId: string;
    userId: number;
    agentId?: string | null;
    title?: string;
    visibility?: ViewVisibility;
    filters?: CreateViewFilters;
    board_filters?: unknown;
    visible_section_ids?: number[];
    sorting_mode?: SortingMode;
    sorting_order?: SortingOrder;
    sorting_stack?: TBoardSortingLevel[];
    subtask_setting?: SubtaskSetting;
    board_empty_sections?: EmptySections;
    setAsDefault?: boolean;
};

// Rename / re-filter / re-sort an existing view. Any field left undefined is untouched.
export async function updateView(input: UpdateViewInput) {
    const { viewId, userId, agentId } = input;
    assertEmptySections(input.board_empty_sections);

    const view = await prisma.view.findUnique({
        where: { id: viewId },
        select: {
            id: true,
            title: true,
            userId: true,
            visibility: true,
            board_filters: true,
            board_sorting_mode: true,
            project_view: {
                select: { id: true, projectId: true, default_view_id: true },
            },
        },
    });
    if (!view) throw new Error('View does not exist');

    const projectId = view.project_view.projectId;
    const access = await validateProjectAccess(projectId, userId, agentId);
    if (access.error) throw new Error(access.error.message);

    if (view.visibility === 'Private' && view.userId !== userId) {
        throw new Error("Cannot edit another user's private view");
    }
    // Visibility itself is owner-only: any board member may re-filter/rename a
    // Public view (existing product semantics), but only the owner may hide it
    // from the rest of the team by flipping it to Private.
    if (input.visibility !== undefined && view.userId !== userId) {
        throw new Error("Only the view's owner can change its visibility");
    }

    const data: Prisma.ViewUpdateInput = {};

    if (input.board_filters !== undefined) {
        data.board_filters = await buildValidatedNativeBoardFilters(projectId, input.board_filters) as Prisma.InputJsonValue;
    }
    if (input.visible_section_ids !== undefined) {
        data.board_columns_view = await canonicalBoardColumns(projectId, input.visible_section_ids) as unknown as Prisma.InputJsonValue;
    }

    if (input.title !== undefined && input.title !== view.title) {
        const clash = await prisma.view.findFirst({
            where: {
                title: input.title,
                project_view: { projectId },
                id: { not: viewId },
            },
            select: { id: true },
        });
        if (clash) {
            throw new Error(`A view titled "${input.title}" already exists on this board`);
        }
        data.title = input.title;
        const slug = await getUniqueSlug(view.project_view.id, input.title);
        if (slug) data.slug = slug;
    }

    if (input.visibility !== undefined) data.visibility = input.visibility;
    if (input.sorting_mode !== undefined) data.board_sorting_mode = input.sorting_mode;
    if (input.sorting_order !== undefined) data.board_sorting_order = input.sorting_order;
    if (input.subtask_setting !== undefined) data.board_subtask_setting = input.subtask_setting;
    if (input.board_empty_sections !== undefined) data.board_empty_sections = input.board_empty_sections;
    if (input.sorting_stack !== undefined) {
        data.board_sorting_stack = sanitizeSortingStack(
            input.sorting_stack,
            input.sorting_mode ?? view.board_sorting_mode
        ) as unknown as Prisma.InputJsonValue;
    }
    if (input.filters !== undefined && input.board_filters === undefined) {
        const storedBoardFilters =
            view.board_filters &&
            typeof view.board_filters === 'object' &&
            !Array.isArray(view.board_filters)
                ? view.board_filters
                : {};
        const storedAddedFilters = Array.isArray(storedBoardFilters.addedFilters)
            ? storedBoardFilters.addedFilters
            : [];
        const storedEntry = (type: string) =>
            storedAddedFilters.find(
                (entry) =>
                    entry !== null &&
                    typeof entry === 'object' &&
                    !Array.isArray(entry) &&
                    entry.type === type
            );
        // Preserve every stored filter type this endpoint doesn't understand
        // (Priority, DueDate, Size, etc. set via the board UI) so a partial
        // label/assignee update via chat/CLI/MCP doesn't silently drop them.
        const otherStoredEntries = storedAddedFilters.filter(
            (entry) =>
                entry !== null &&
                typeof entry === 'object' &&
                !Array.isArray(entry) &&
                entry.type !== 'Labels' &&
                entry.type !== 'Assignees'
        );

        // A rebuilt entry is a fresh object, so it loses the per-filter ANY/ALL mode the board UI
        // stored. Carry it across, or changing a view's labels via chat/CLI silently widens it.
        const keepMatch = (
            entry: BoardFilterEntry | undefined,
            type: 'Labels' | 'Assignees'
        ) => {
            if (!entry) return entry;
            const previous = storedEntry(type) as { match?: unknown } | undefined;
            return previous?.match === 'ALL' || previous?.match === 'ANY'
                ? { ...entry, match: previous.match }
                : entry;
        };

        const labelsEntry =
            input.filters.label_names === undefined
                ? storedEntry('Labels')
                : keepMatch(
                      await buildLabelsFilterEntry(projectId, input.filters.label_names),
                      'Labels'
                  );
        const assigneesEntry =
            input.filters.assignee_ids === undefined
                ? storedEntry('Assignees')
                : keepMatch(
                      await buildAssigneesFilterEntry(projectId, input.filters.assignee_ids),
                      'Assignees'
                  );
        const existingMatchFilters =
            storedBoardFilters.matchFilters === 'ALL' ||
            storedBoardFilters.matchFilters === 'ANY'
                ? storedBoardFilters.matchFilters
                : undefined;
        const board_filters = sanitizeBoardFilters({
            matchFilters: input.filters.match ?? existingMatchFilters ?? 'ANY',
            addedFilters: [...otherStoredEntries, labelsEntry, assigneesEntry].filter(
                (entry) => entry !== undefined
            ),
        });
        data.board_filters = board_filters as unknown as Prisma.InputJsonValue;
    }

    const updateArgs = {
        where: { id: viewId },
        data,
        select: {
            id: true,
            title: true,
            slug: true,
            visibility: true,
            board_filters: true,
            board_sorting_mode: true,
            board_sorting_order: true,
            board_sorting_stack: true,
            board_columns_view: true,
            board_subtask_setting: true,
            board_empty_sections: true,
        },
    } satisfies Prisma.ViewUpdateArgs;
    const updated = await prisma.$transaction(async (tx) => {
        await acquireBoardFilterWriteLock(tx, projectId);
        await assertViewIsNotManagedSmartSplit(tx, projectId, viewId);
        if (data.board_filters !== undefined) {
            await validateBoardFilterLabelReferences(
                tx,
                projectId,
                data.board_filters
            );
        }
        const result = await tx.view.update(updateArgs);
        if (input.setAsDefault) {
            await tx.project_View.update({
                where: { projectId },
                data: { default_view_id: viewId },
            });
        }
        return result;
    });

    broadcastBoardChange(projectId, { originUserId: userId });

    return {
        id: updated.id,
        title: updated.title,
        slug: updated.slug,
        url: updated.slug ? getViewUrl(projectId, updated.slug) : null,
        visibility: updated.visibility,
        projectId,
        filters: sanitizeBoardFilters(updated.board_filters),
        sorting_mode: updated.board_sorting_mode,
        sorting_order: updated.board_sorting_order,
        sorting_stack: updated.board_sorting_stack,
        board_columns_view: updated.board_columns_view,
        board_subtask_setting: updated.board_subtask_setting,
        board_empty_sections: updated.board_empty_sections,
        isDefault: input.setAsDefault
            ? true
            : view.project_view.default_view_id === viewId,
    };
}

// Switch the caller's active view on a board (what the highlighted tab reflects).
// Applying the board's default view clears appliedView back to null.
export async function applyView(input: { viewId: string; userId: number; agentId?: string | null }) {
    const { viewId, userId, agentId } = input;

    const view = await prisma.view.findUnique({
        where: { id: viewId },
        select: {
            id: true,
            title: true,
            userId: true,
            visibility: true,
            project_view: {
                select: { id: true, projectId: true, default_view_id: true },
            },
        },
    });
    if (!view) throw new Error('View does not exist');

    const projectId = view.project_view.projectId;
    const access = await validateProjectAccess(projectId, userId, agentId);
    if (access.error) throw new Error(access.error.message);

    if (view.visibility === 'Private' && view.userId !== userId) {
        throw new Error("Cannot switch to another user's private view");
    }

    const isDefault = view.project_view.default_view_id === viewId;
    const appliedViewId = isDefault ? null : viewId;

    const userProjectView = await prisma.user_Project_View.upsert({
        create: {
            userId,
            project_view_id: view.project_view.id,
            appliedViewId,
        },
        update: { appliedViewId },
        where: {
            user_project: { userId, project_view_id: view.project_view.id },
        },
    });

    const now = new Date();
    await prisma.view.update({ where: { id: viewId }, data: { lastUsedAt: now } });
    await prisma.view_Last_Used.upsert({
        create: { userId, viewId, lastUsedAt: now },
        update: { lastUsedAt: now },
        where: { user_view_last_used: { userId, viewId } },
    });

    // Switching away discards any unsaved draft view, matching the board UI.
    if (userProjectView.unsavedViewId && userProjectView.unsavedViewId !== viewId) {
        await prisma.view
            .delete({ where: { id: userProjectView.unsavedViewId } })
            .catch(() => undefined);
    }

    broadcastBoardChange(projectId, { originUserId: userId });

    return {
        applied_view_id: appliedViewId,
        is_default: isDefault,
        view: { id: view.id, title: view.title, projectId },
    };
}

export async function deleteView(viewId: string, userId: number, agentId?: string | null) {
    const view = await prisma.view.findUnique({
        where: { id: viewId },
        select: {
            id: true,
            title: true,
            userId: true,
            visibility: true,
            project_view: { select: { projectId: true, default_view_id: true } },
        },
    });
    if (!view) throw new Error('View does not exist');

    const access = await validateProjectAccess(view.project_view.projectId, userId, agentId);
    if (access.error) throw new Error(access.error.message);

    if (view.visibility === 'Private' && view.userId !== userId) {
        throw new Error("Cannot delete another user's private view");
    }
    if (view.project_view.default_view_id === view.id) {
        throw new Error(
            "This is the board's default view. Make another view the default before deleting it."
        );
    }

    await prisma.$transaction(async (tx) => {
        await acquireBoardFilterWriteLock(tx, view.project_view.projectId);
        await assertViewIsNotManagedSmartSplit(
            tx,
            view.project_view.projectId,
            view.id
        );

        // Nothing may still point at the view when it goes (appliedView/unsavedView
        // are FKs), so unhook it everywhere first.
        await tx.user_Project_View.updateMany({
            where: { appliedViewId: view.id },
            data: { appliedViewId: null },
        });
        await tx.user_Project_View.updateMany({
            where: { unsavedViewId: view.id },
            data: { unsavedViewId: null },
        });
        await tx.view_Last_Used.deleteMany({ where: { viewId: view.id } });
        // Re-check default-ness at delete time. Because the board row is locked,
        // a concurrent default-view change cannot cross this mutation.
        const deleted = await tx.view.deleteMany({
            where: {
                id: view.id,
                project_view: { default_view_id: { not: view.id } },
            },
        });
        if (deleted.count === 0) {
            throw new Error(
                "This is the board's default view. Make another view the default before deleting it."
            );
        }
    });

    broadcastBoardChange(view.project_view.projectId, { originUserId: userId });

    return { id: view.id, title: view.title, projectId: view.project_view.projectId };
}
