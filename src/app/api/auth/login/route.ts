import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { getSession } from "@/lib/auth";
import { getUserByEmail } from "@/lib/db";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const email = String(body.email || "")
      .trim()
      .toLowerCase();
    const password = String(body.password || "");

    if (!email || !password) {
      return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
    }

    const user = getUserByEmail(email);
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
    }

    const session = await getSession();
    session.user = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    };
    await session.save();

    return NextResponse.json({ user: session.user });
  } catch {
    return NextResponse.json({ error: "Login failed." }, { status: 500 });
  }
}
