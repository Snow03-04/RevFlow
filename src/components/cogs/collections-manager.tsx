"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Layers, Plus, Trash2, Loader2, ChevronDown } from "lucide-react";
import type { CogsCollection } from "@/lib/queries";
import {
  createCollection,
  renameCollection,
  deleteCollection,
  saveCollectionBaseCost,
  saveCollectionTier,
  recomputeAllMetricsAction,
} from "@/lib/cogs/actions";
import { TierEditor } from "@/components/cogs/tier-editor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { currencySymbol, parseCostInput, cn } from "@/lib/utils";

export function CollectionsManager({
  collections,
  products,
  currency,
}: {
  collections: CogsCollection[];
  products: { productId: string; title: string }[];
  currency: string;
}) {
  const router = useRouter();
  const [newName, setNewName] = useState("");
  const [creating, startCreate] = useTransition();
  const [openId, setOpenId] = useState<string | null>(null);
  const sym = currencySymbol(currency);

  const nameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of products) m.set(p.productId, p.title);
    return m;
  }, [products]);

  function recalc() {
    void recomputeAllMetricsAction();
  }

  function create() {
    if (!newName.trim()) return;
    startCreate(async () => {
      const res = await createCollection(newName);
      if (!res.ok) {
        alert(res.error ?? "Falha ao criar a coleção.");
        return;
      }
      setNewName("");
      setOpenId(res.id ?? null);
      router.refresh();
    });
  }

  return (
    <Card className="space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4 text-primary" />
          <div>
            <h3 className="text-sm font-semibold">Coleções de custos</h3>
            <p className="text-xs text-muted-foreground">
              Agrupa produtos que partilham a mesma tabela de preços por
              quantidade. Numa encomenda, soma-se as unidades da coleção e aplica-se
              o escalão (substitui o custo individual).
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && create()}
            placeholder="Nome da coleção…"
            className="w-[200px]"
          />
          <Button onClick={create} disabled={creating || !newName.trim()}>
            {creating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            Criar
          </Button>
        </div>
      </div>

      {collections.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          Ainda não tens coleções. Cria uma acima e depois, na tabela de
          produtos, escolhe a coleção de cada produto.
        </p>
      ) : (
        <ul className="space-y-2">
          {collections.map((c) => (
            <CollectionRow
              key={c.id}
              collection={c}
              open={openId === c.id}
              onToggle={() => setOpenId(openId === c.id ? null : c.id)}
              nameById={nameById}
              currency={currency}
              sym={sym}
              onChanged={recalc}
              onStructuralChange={() => router.refresh()}
            />
          ))}
        </ul>
      )}
    </Card>
  );
}

function CollectionRow({
  collection: c,
  open,
  onToggle,
  nameById,
  currency,
  sym,
  onChanged,
  onStructuralChange,
}: {
  collection: CogsCollection;
  open: boolean;
  onToggle: () => void;
  nameById: Map<string, string>;
  currency: string;
  sym: string;
  onChanged: () => void;
  onStructuralChange: () => void;
}) {
  const [name, setName] = useState(c.name);
  const [baseText, setBaseText] = useState(
    c.baseUnitCost ? String(c.baseUnitCost) : "",
  );
  const [deleting, startDelete] = useTransition();

  function saveName() {
    if (name.trim() && name.trim() !== c.name) {
      void renameCollection(c.id, name).then(onStructuralChange);
    }
  }

  function saveBase() {
    const v = parseCostInput(baseText) ?? 0;
    void saveCollectionBaseCost(c.id, v).then(onChanged);
  }

  function del() {
    if (!confirm(`Apagar a coleção "${c.name}"? Os produtos ficam sem coleção.`))
      return;
    startDelete(async () => {
      const res = await deleteCollection(c.id);
      if (!res.ok) alert(res.error ?? "Falha ao apagar.");
      else {
        onChanged();
        onStructuralChange();
      }
    });
  }

  return (
    <li className="rounded-lg border border-border bg-card">
      <div className="flex flex-wrap items-center gap-3 px-3 py-2">
        <button
          onClick={onToggle}
          className={cn(
            "rounded-md p-1 text-muted-foreground transition-transform hover:text-foreground",
            open && "rotate-180",
          )}
          title="Abrir/fechar"
        >
          <ChevronDown className="h-4 w-4" />
        </button>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={saveName}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          className="h-8 w-[180px] font-medium"
        />
        <Badge variant="muted">
          {c.productIds.length} produto{c.productIds.length === 1 ? "" : "s"}
        </Badge>
        <div className="flex items-center gap-1 rounded-md border border-input bg-background px-2">
          <span className="text-xs text-muted-foreground">{sym}</span>
          <input
            type="text"
            inputMode="decimal"
            value={baseText}
            onChange={(e) => setBaseText(e.target.value.replace(/[^\d.,]/g, ""))}
            onBlur={saveBase}
            placeholder="custo/u"
            title="Custo por unidade dos membros (substitui o custo individual)"
            className="w-20 bg-transparent px-1 py-1.5 text-right text-sm tabular-nums outline-none"
          />
        </div>
        <button
          onClick={del}
          disabled={deleting}
          className="ml-auto text-muted-foreground hover:text-destructive disabled:opacity-50"
          title="Apagar coleção"
        >
          {deleting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Trash2 className="h-4 w-4" />
          )}
        </button>
      </div>

      {open && (
        <div className="space-y-3 border-t border-border px-4 py-3">
          <div>
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Escalões da coleção (custo total por nº de unidades levadas juntas)
            </p>
            <TierEditor
              tiers={c.tiers}
              currency={currency}
              unitCost={c.baseUnitCost}
              onSave={(minQty, total) => saveCollectionTier(c.id, minQty, total)}
              afterChange={onChanged}
            />
          </div>
          <div>
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Produtos nesta coleção
            </p>
            {c.productIds.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Nenhum. Na tabela de produtos, escolhe esta coleção no produto.
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {c.productIds.map((pid) => (
                  <Badge key={pid} variant="muted">
                    {nameById.get(pid) ?? pid}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </li>
  );
}
