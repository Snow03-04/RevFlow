"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { clientEnv } from "@/lib/env";

export interface AuthState {
  error?: string;
  message?: string;
}

const credentials = z.object({
  email: z.string().email("Enter a valid email address."),
  password: z.string().min(8, "Password must be at least 8 characters."),
});

export async function signInAction(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const parsed = credentials.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.errors[0]?.message ?? "Invalid input." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return { error: error.message };

  const redirectTo = (formData.get("redirectTo") as string) || "/dashboard";
  revalidatePath("/", "layout");
  redirect(redirectTo);
}

export async function signUpAction(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const schema = credentials.extend({
    fullName: z.string().min(1, "Enter your name.").optional(),
  });
  const parsed = schema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    fullName: formData.get("fullName") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.errors[0]?.message ?? "Invalid input." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { full_name: parsed.data.fullName },
      emailRedirectTo: `${clientEnv.appUrl}/auth/callback?next=/dashboard`,
    },
  });
  if (error) return { error: error.message };

  // If email confirmation is enabled there is no session yet.
  if (data.session) {
    revalidatePath("/", "layout");
    redirect("/dashboard");
  }

  return {
    message:
      "Check your inbox to confirm your email address, then sign in.",
  };
}

export async function signInWithGoogleAction(): Promise<AuthState> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${clientEnv.appUrl}/auth/callback?next=/dashboard`,
    },
  });
  if (error) return { error: error.message };
  if (data.url) redirect(data.url);
  return { error: "Could not start Google sign-in." };
}

export async function signOutAction(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login");
}
