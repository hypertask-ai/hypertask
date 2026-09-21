import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export async function GET(request: NextRequest) {
    try {
        // HTPR-4808: /reset admin tool only. This enumerates the whole user
        // table with no team or board scoping, so accepting any signed-in
        // session would let a fresh trial account read every user on the
        // platform. Same gate as resetUser and reset-trial.
        const adminPassword = process.env.ADMIN_USER_RESET_PW;
        if (
            !adminPassword ||
            request.headers.get('x-admin-password') !== adminPassword
        ) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const searchParams = request.nextUrl.searchParams;
        const query = searchParams.get('q') || '';
        const limit = parseInt(searchParams.get('limit') || '50', 10);

        if (!query || query.trim().length < 2) {
            return NextResponse.json(
                { error: 'Search query must be at least 2 characters long' },
                { status: 400 }
            );
        }

        const searchTerm = query.trim().toLowerCase();

        // Prisma's case-insensitive search depends on the database provider
        // For PostgreSQL, we can use mode: 'insensitive'
        // For MySQL/SQLite, we'll use toLowerCase in the query
        const users = await prisma.user.findMany({
            where: {
                OR: [
                    {
                        email: {
                            contains: searchTerm,
                        },
                    },
                    {
                        displayName: {
                            contains: searchTerm,
                        },
                    },
                ],
            },
            take: limit,
            orderBy: {
                joinedAt: 'desc',
            },
            select: {
                id: true,
                email: true,
                displayName: true,
                photoURL: true,
                UserSetting: {
                    select: {
                        trialStatus: true,
                    },
                },
                joinedAt: true,
            },
        });

        // Filter case-insensitively in memory for better compatibility
        const filteredUsers = users.filter(
            (user) =>
                user.email?.toLowerCase().includes(searchTerm) ||
                user.displayName?.toLowerCase().includes(searchTerm)
        );

        return NextResponse.json({
            success: true,
            users: filteredUsers,
            count: filteredUsers.length,
        });
    } catch (error: any) {
        console.error('❌ Error searching users:', error);
        return NextResponse.json(
            {
                success: false,
                error: error.message || 'Failed to search users',
            },
            { status: 500 }
        );
    }
}
