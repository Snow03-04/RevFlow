import { Suspense } from "react";
import type { Metadata } from "next";
import { AuthForm } from "@/components/auth/auth-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const metadata: Metadata = { title: "Criar conta" };

export default function SignupPage() {
  return (
    <Card className="animate-fade-in shadow-xl">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl">O teu negócio começa aqui.</CardTitle>
        <CardDescription>
          Cria a tua conta para escolher um plano RevFlow.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Suspense>
          <AuthForm mode="signup" />
        </Suspense>
      </CardContent>
    </Card>
  );
}
