import { NextResponse } from "next/server";
import { fetchGitHubReadData } from "@/lib/github-read";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const repo = url.searchParams.get("repo")?.trim();

  if (!repo) {
    return jsonError("A GitHub repo in the format owner/name is required.", 400);
  }

  try {
    const result = await fetchGitHubReadData({
      repo,
      includeReadme: url.searchParams.get("readme") === "1",
      includePrs: url.searchParams.get("prs") !== "0",
      includeIssues: url.searchParams.get("issues") !== "0",
      includeCommits: url.searchParams.get("commits") !== "0",
      includeActions: url.searchParams.get("actions") !== "0",
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "GitHub read request failed.";
    return jsonError(message, 400);
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { repo?: string; readme?: boolean; prs?: boolean; issues?: boolean; commits?: boolean; actions?: boolean };
    const repo = body.repo?.trim();

    if (!repo) {
      return jsonError("A GitHub repo in the format owner/name is required.", 400);
    }

    const result = await fetchGitHubReadData({
      repo,
      includeReadme: body.readme ?? true,
      includePrs: body.prs ?? true,
      includeIssues: body.issues ?? true,
      includeCommits: body.commits ?? true,
      includeActions: body.actions ?? true,
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "GitHub read request failed.";
    return jsonError(message, 400);
  }
}
