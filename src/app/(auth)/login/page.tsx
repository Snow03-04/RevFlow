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

export const metadata: Metadata = { title: "Entrar" };

export default function LoginPage() {
  return (
    <Card className="animate-fade-in shadow-xl">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl">Bem-vindo de volta.</CardTitle>
        <CardDescription>
          Entra para acompanhar o que realmente lucras.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Suspense>
          <AuthForm mode="login" />
        </Suspense>
      </CardContent>
    </Card>
  );
}
