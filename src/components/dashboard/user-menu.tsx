"use client";

import { LogOut, User as UserIcon, ShieldCheck, CreditCard } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { signOutAction } from "@/lib/auth/actions";

export function UserMenu({
  email,
  name,
  avatarUrl,
  isAdmin = false,
}: {
  email: string;
  name: string | null;
  avatarUrl: string | null;
  isAdmin?: boolean;
}) {
  const initials = (name ?? email)
    .split(" ")
    .map((s) => s[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <Avatar>
          {avatarUrl && <AvatarImage src={avatarUrl} alt={name ?? email} />}
          <AvatarFallback>{initials}</AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel className="flex flex-col">
          <span className="truncate text-sm">{name ?? "Account"}</span>
          <span className="truncate text-xs font-normal text-muted-foreground">
            {email}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {isAdmin && <DropdownMenuItem asChild><a href="/admin"><ShieldCheck className="h-4 w-4"/> Administração</a></DropdownMenuItem>}
        <DropdownMenuItem asChild><a href="/subscribe"><CreditCard className="h-4 w-4"/> Subscrição</a></DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a href="/settings">
            <UserIcon className="h-4 w-4" /> Settings
          </a>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <form action={signOutAction}>
          <button type="submit" className="w-full">
            <DropdownMenuItem className="text-destructive focus:text-destructive">
              <LogOut className="h-4 w-4" /> Sign out
            </DropdownMenuItem>
          </button>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
