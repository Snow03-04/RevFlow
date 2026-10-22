/** Presentation only: keep technical diagnostics in the sync records. */
export function metaNeedsReconnect(message: string | null | undefined) {
  return !!message && /Meta Graph error (?:190|102)\b|A ligação à Meta precisa de ser renovada/i.test(message);
}

export function syncFeedback(error: string) {
  const notices: { title: string; detail: string }[] = [];
  const reconnect = metaNeedsReconnect(error);
  const timeout = /statement timeout|demorou demasiado|tempo limite|timed?\s*out|HTTP 504/i.test(error);
  const session = /Sessão expirada/i.test(error);
  const offline = /Sem ligação|ligação ao servidor foi interrompida/i.test(error);
  const serverFailure = /HTTP (?!504)5\d\d|não foi possível atualizar|não foi possível concluir/i.test(error);
  if (reconnect) {
    const accounts = [...new Set([...error.matchAll(/Meta · ([^:·]+): (?:Meta Graph error (?:190|102)\b|A ligação à Meta precisa de ser renovada)/g)].map(match => match[1].trim()))];
    notices.push({ title: "Voltar a ligar a Meta", detail: `${accounts.length ? `${accounts.join(" e ")}. ` : ""}O acesso foi invalidado pelo Facebook. Renova a ligação em Connections para receber novos dados.` });
  }
  if (timeout) notices.push({ title: "Atualização por concluir", detail: "Algumas consultas demoraram demasiado. Os dados já guardados continuam disponíveis; a atualização será tentada novamente." });
  if (session) notices.push({ title: "Sessão expirada", detail: "Inicia sessão novamente para retomar as atualizações." });
  if (offline) notices.push({ title: "Ligação interrompida", detail: "A atualização retoma quando a ligação estiver disponível." });
  if (serverFailure || !notices.length) notices.push({ title: "Atualização incompleta", detail: "Não foi possível confirmar todos os dados. Tenta atualizar novamente; se o aviso persistir, verifica as ligações." });
  return { notices, reconnect, session };
}
