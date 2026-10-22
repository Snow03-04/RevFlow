"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { clientEnv } from "@/lib/env";
import { safeRedirect } from "@/lib/auth/redirect";

export interface AuthState {
  error?: string;
  message?: string;
}

const credentials = z.object({
  email: z.string().email("Indica um email válido."),
  password: z.string().min(8, "A palavra-passe deve ter pelo menos 8 caracteres.").max(256, "A palavra-passe é demasiado longa."),
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
  if (error) return { error: "Não foi possível entrar. Confirma os dados e a confirmação do email." };

  const redirectTo = safeRedirect(formData.get("redirectTo"));
  revalidatePath("/", "layout");
  redirect(redirectTo);
}

export async function signUpAction(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const schema = credentials.extend({
    fullName: z.string().trim().min(1, "Indica o teu nome.").max(100).optional(),
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
      emailRedirectTo: `${clientEnv.appUrl}/auth/callback?next=${encodeURIComponent(safeRedirect(formData.get("redirectTo"), "/subscribe"))}`,
    },
  });
  if (error) return { error: "Não foi possível criar a conta. Verifica os dados ou tenta iniciar sessão." };

  // If email confirmation is enabled there is no session yet.
  if (data.session) {
    revalidatePath("/", "layout");
    redirect(safeRedirect(formData.get("redirectTo"), "/subscribe"));
  }

  return {
    message:
      "Verifica o teu email para confirmar a conta e depois inicia sessão.",
  };
}

export async function signInWithGoogleAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${clientEnv.appUrl}/auth/callback?next=${encodeURIComponent(safeRedirect(formData.get("redirectTo")))}`,
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
