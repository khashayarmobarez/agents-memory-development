import { NextResponse } from "next/server";

/** Under `strict`, a caught error is `unknown` — narrow before reading .message. */
export const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const badRequest = (error: string, details?: string[]) =>
  NextResponse.json(details ? { error, details } : { error }, { status: 400 });

export const notFound = (error: string) =>
  NextResponse.json({ error }, { status: 404 });

/** 503, not 500: the route is fine, a dependency is not. */
export const unavailable = (error: unknown) =>
  NextResponse.json({ error: messageOf(error) }, { status: 503 });
