import { NextRequest, NextResponse } from 'next/server';
import { hasSubscription } from '@/lib/subscription';

export async function POST(request: NextRequest) {
  try {
    const { teamId } = await request.json();
    
    if (!teamId) {
      return NextResponse.json({ error: 'Team ID is required' }, { status: 400 });
    }

    // Run subscription check in background
    const subscriptionStatus = await hasSubscription(teamId);
    
    return NextResponse.json({ 
      success: true, 
      subscriptionStatus 
    });
  } catch (error) {
    console.error('❌ Subscription check failed:', error);
    return NextResponse.json({ 
      success: false, 
      error: 'Subscription check failed' 
    }, { status: 500 });
  }
} 