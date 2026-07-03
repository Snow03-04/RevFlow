"use client";

import { useState } from "react";
import { X, Tag as TagIcon } from "lucide-react";
import { updateProduct } from "@/lib/research/actions";

const SUGGESTED = ["Beauty", "Kitchen", "Pets", "Fitness", "Fashion", "Gadget", "Home", "Seasonal"];

export function TagInput({
  productId,
  initial,
}: {
  productId: string;
  initial: string[];
}) {
  const [tags, setTags] = useState<string[]>(initial);
  const [input, setInput] = useState("");

  function save(next: string[]) {
    setTags(next);
    updateProduct(productId, { tags: next });
  }
  function add(raw: string) {
    const t = raw.trim();
    if (!t || tags.includes(t)) return;
    save([...tags, t]);
    setInput("");
  }
  function remove(t: string) {
    save(tags.filter((x) => x !== t));
  }

  const suggestions = SUGGESTED.filter((s) => !tags.includes(s));

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {tags.map((t) => (
          <span
            key={t}
            className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary"
          >
            {t}
            <button onClick={() => remove(t)} className="opacity-70 hover:opacity-100">
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <span className="inline-flex items-center gap-1 text-muted-foreground">
          <TagIcon className="h-3.5 w-3.5" />
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === ",") {
                e.preventDefault();
                add(input);
              }
            }}
            placeholder="+ tag"
            className="w-24 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
          />
        </span>
      </div>
      {suggestions.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {suggestions.map((s) => (
            <button
              key={s}
              onClick={() => add(s)}
              className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground"
            >
              + {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
