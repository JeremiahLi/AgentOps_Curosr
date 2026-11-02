import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";


export async function GET(
  _req: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  const decodedName = decodeURIComponent(name);

  const agent = await prisma.agent.findUnique({
    where: { name: decodedName },
  });

  if (!agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  return NextResponse.json(agent);
}
