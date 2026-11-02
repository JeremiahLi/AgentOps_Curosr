import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";


export async function GET() {
  const agents = await prisma.agent.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      emoji: true,
      description: true,
      framework: true,
      version: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  return NextResponse.json(agents);
}