import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedUser } from "@/lib/supabase/server";
import { billingRpc } from "@/lib/billing/server";
import { isSameOrigin, rateLimit, readLimitedBody } from "@/lib/security/request";
const schema=z.object({name:z.string().trim().min(1).max(100),email:z.string().trim().email().max(254),subject:z.enum(["Apoio ao RevFlow","Privacidade e acesso aos dados","Eliminar a minha conta e dados","Subscrições e pagamentos","Segurança"]),message:z.string().trim().min(20).max(4000),website:z.string().max(0).optional()});
export async function POST(request:Request){
 if(!isSameOrigin(request))return NextResponse.json({error:"Pedido não autorizado."},{status:403});
 try{const parsed=schema.safeParse(JSON.parse(await readLimitedBody(request,20000)));if(!parsed.success)return NextResponse.json({error:"Confirma os campos. A mensagem deve ter entre 20 e 4000 caracteres."},{status:400});if(!(await rateLimit(request,"contact",5,3600)))return NextResponse.json({error:"Já recebemos vários pedidos desta ligação. Tenta novamente dentro de uma hora."},{status:429});const user=await getAuthenticatedUser();const reference=await billingRpc<string>("revflow_contact",{p_user_id:user?.id??null,p_name:parsed.data.name,p_email:parsed.data.email,p_subject:parsed.data.subject,p_message:parsed.data.message});return NextResponse.json({reference},{status:201});}
 catch{return NextResponse.json({error:"Não foi possível registar o pedido. Tenta novamente mais tarde."},{status:503});}
}
