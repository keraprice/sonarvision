import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { verifySession } from "@/lib/crypto";
import { getSessionSecret } from "@/lib/auth";
import { getCookieValue } from "@/lib/cookie";

const schema = z.object({
  url: z.string().url(),
  label: z.string().optional(),
  type: z
    .string()
    .optional()
    .transform((val) => val || "OTHER"),
});

async function getSessionOrThrow(headers: Headers) {
  const token = await getCookieValue("ft_session", headers);
  const session = verifySession(token, getSessionSecret());
  if (!session) throw new Error("unauthorized");
  return session;
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const session = await getSessionOrThrow(request.headers);
    const json = await request.json().catch(() => null);
    const parsed = schema.safeParse(json);
    if (!parsed.success) return NextResponse.json({ error: "Invalid payload" }, { status: 400 });

    const feature = await prisma.feature.findFirst({
      where: { id: params.id, teamId: session.teamId },
    });
    if (!feature) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const link = await prisma.link.create({
      data: {
        featureId: feature.id,
        url: parsed.data.url,
        label: parsed.data.label,
        type: parsed.data.type ?? "OTHER",
      },
    });

    return NextResponse.json(link, { status: 201 });
  } catch (error) {
    if ((error as Error).message === "unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("Failed to add link", error);
    return NextResponse.json({ error: "Failed to add link" }, { status: 500 });
  }
}
