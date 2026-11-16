import type { RefreshIssue } from "./protocol";

/** Presentation only: keep technical diagnostics in the sync records. */
export function metaNeedsReconnect(message: string | null | undefined) {
  return !!message && /Meta Graph error (?:190|102)\b|A ligação à Meta precisa de ser renovada/i.test(message);
}

export function syncFeedback(error: string, issue?: RefreshIssue, failedTasks: string[] = []) {
  const notices: { title: string; detail: string }[] = [];
  const reconnect = metaNeedsReconnect(error);
  const timeout = /statement timeout|demorou demasiado|tempo limite|timed?\s*out|HTTP 504/i.test(error);
  const session = /Sessão expirada/i.test(error);
  const offline = /Sem ligação|ligação ao servidor foi interrompida/i.test(error);
  const serverFailure = /HTTP (?!504)5\d\d|não foi possível atualizar|não foi possível concluir/i.test(error);
  if (issue === "status" && !session) {
    notices.push({ title: "Estado indisponível", detail: "Não foi possível consultar o estado da última atualização." });
    return { notices, reconnect: false, session: false };
  }
  if (issue === "confirmation") {
    notices.push({ title: "Confirmação pendente", detail: "As etapas terminaram. Falta confirmar o registo final no RevFlow." });
    return { notices, reconnect: false, session: false };
  }
  if (reconnect) {
    const accounts = [...new Set([...error.matchAll(/Meta · ([^:·]+): (?:Meta Graph error (?:190|102)\b|A ligação à Meta precisa de ser renovada)/g)].map(match => match[1].trim()))];
    notices.push({ title: "Voltar a ligar a Meta", detail: `${accounts.length ? `${accounts.join(" e ")}. ` : ""}O acesso foi invalidado pelo Facebook. Renova a ligação em Connections para receber novos dados.` });
  }
  if (timeout) notices.push({ title: "Tempo de resposta excedido", detail: "Algumas consultas demoraram demasiado. Os dados já guardados continuam disponíveis." });
  if (session) notices.push({ title: "Sessão expirada", detail: "Inicia sessão novamente para retomar as atualizações." });
  if (offline) notices.push({ title: "Ligação interrompida", detail: "Tenta atualizar quando a ligação estiver disponível." });
  if (failedTasks.length) notices.push({ title: "Por atualizar", detail: failedTasks.join(", ") });
  else if (issue === "start" && !notices.length) notices.push({ title: "Não foi possível iniciar a atualização", detail: "Tenta novamente dentro de momentos." });
  else if (serverFailure || !notices.length) notices.push({ title: "Atualização incompleta", detail: "O RevFlow não conseguiu confirmar todas as etapas desta atualização." });
  return { notices, reconnect, session };
}
