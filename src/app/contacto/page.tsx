import { LegalPage } from "@/components/marketing/legal-page";
import { ContactForm } from "@/components/marketing/contact-form";
export const metadata={title:"Contacto e privacidade"};
export default function ContactPage(){return <LegalPage title="Estamos deste lado." intro="Precisas de ajuda, queres esclarecer uma questão ou exercer um direito sobre os teus dados? Envia um pedido à equipa RevFlow."><p>A mensagem fica registada na área de apoio da equipa. Indica um email de resposta válido. Não envies palavras-passe, códigos de acesso, tokens de integrações ou dados de cartões.</p><ContactForm/></LegalPage>;}
