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

export const metadata: Metadata = { title: "Create account" };

export default function SignupPage() {
  return (
    <Card className="animate-fade-in shadow-xl">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl">Create your account</CardTitle>
        <CardDescription>
          Start tracking profit across Shopify and Meta Ads.
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
