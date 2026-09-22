import { NextResponse } from 'next/server';
import { processDueReminders } from '@/lib/reminder-service';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return handleCronJob(request);
}

export async function POST(request: Request) {
  return handleCronJob(request);
}

export async function handleCronJob(request: Request) {
  const expectedSecret = process.env.CRON_SECRET;
  const isDev = process.env.NODE_ENV === 'development';

  // Production authentication enforcement
  if (expectedSecret) {
    const url = new URL(request.url);
    const authHeader = request.headers.get('authorization');
    const cronSecretHeader = request.headers.get('x-cron-secret');
    const querySecret = url.searchParams.get('secret');

    const isBearerValid = authHeader === `Bearer ${expectedSecret}`;
    const isCustomHeaderValid = cronSecretHeader === expectedSecret;
    const isQuerySecretValid = querySecret === expectedSecret;

    if (!isBearerValid && !isCustomHeaderValid && !isQuerySecretValid) {
      console.warn('[CRON API] Unauthorized cron request attempt');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  } else if (!isDev) {
    console.error('[CRON API] CRON_SECRET environment variable is missing in production environment');
    return NextResponse.json(
      { error: 'Server authentication configuration missing' },
      { status: 500 }
    );
  }

  // Process Due Reminders Engine
  try {
    const result = await processDueReminders();
    return NextResponse.json(result, { status: result.success ? 200 : 500 });
  } catch (err: any) {
    console.error('[CRON API] Fatal error executing reminder engine:', err);
    return NextResponse.json({ error: 'Internal server error executing scheduler', success: false }, { status: 500 });
  }
}
