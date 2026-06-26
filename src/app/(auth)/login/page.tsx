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

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <Card className="animate-fade-in shadow-xl">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl">Welcome back</CardTitle>
        <CardDescription>
          Sign in to track your store&apos;s real profit.
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
