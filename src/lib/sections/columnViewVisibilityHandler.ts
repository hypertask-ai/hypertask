import { NextRequest, NextResponse } from "next/server";

export type ColumnViewVisibilitySection = {
  id: number;
  projectId: number;
  section_title: string;
  ranking: string;
};

export type ColumnViewVisibilityDependencies = {
  session: (headers: Headers) => Promise<{ userId: number } | null>;
  featureEnabled: (userId: number) => Promise<boolean>;
  findSection: (
    userId: number,
    sectionId: number
  ) => Promise<ColumnViewVisibilitySection | null>;
  setVisibility: (
    section: ColumnViewVisibilitySection,
    visible: boolean,
    actingUserId: number
  ) => Promise<void>;
  afterChange: (projectId: number, userId: number) => void;
};

export const createColumnViewVisibilityHandler =
  (dependencies: ColumnViewVisibilityDependencies) =>
  async (request: NextRequest) => {
    const session = await dependencies.session(request.headers);
    if (!session) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    if (!(await dependencies.featureEnabled(session.userId))) {
      return NextResponse.json(
        { success: false, error: "Not available" },
        { status: 403 }
      );
    }

    const body = await request.json().catch(() => null);
    const sectionId = Number(body?.sectionId);
    const visible = body?.visible;

    if (!Number.isInteger(sectionId) || sectionId <= 0 || typeof visible !== "boolean") {
      return NextResponse.json(
        { success: false, error: "sectionId and a boolean visible are required" },
        { status: 400 }
      );
    }

    const section = await dependencies.findSection(session.userId, sectionId);
    if (!section) {
      return NextResponse.json(
        { success: false, error: "Column not found or access denied" },
        { status: 404 }
      );
    }

    await dependencies.setVisibility(section, visible, session.userId);
    dependencies.afterChange(section.projectId, session.userId);

    return NextResponse.json({ success: true, sectionId: section.id, visible });
  };
