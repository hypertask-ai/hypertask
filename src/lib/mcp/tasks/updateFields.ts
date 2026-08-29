export interface SingleTaskUpdateFields {
    title?: unknown;
    description?: unknown;
    parent_task_id?: unknown;
}

export function hasSingleTaskUpdate(body: SingleTaskUpdateFields): boolean {
    return body.title !== undefined ||
        body.description !== undefined ||
        body.parent_task_id !== undefined;
}
