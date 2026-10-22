"use client";
import { useEffect } from "react";
import base from "./marketing.module.css";
import motion from "./demo.module.css";
const s = { ...base, ...motion };
export function LandingMotion(){useEffect(()=>{
  const motion=window.matchMedia("(prefers-reduced-motion: reduce)");if(motion.matches)return;
  const elements=Array.from(document.querySelectorAll<HTMLElement>(`.${s.sectionHeading}, .${s.featureCard}, .${s.steps}>article, .${s.plan}, .${s.featuredPlan}, .${s.finalCta}`));
  const observer=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting){(entry.target as HTMLElement).dataset.revealed="true";observer.unobserve(entry.target);}},{threshold:.08,rootMargin:"0px 0px -25px 0px"});
  elements.forEach((el)=>{if(el.getBoundingClientRect().top<window.innerHeight)return;el.dataset.revealed="false";el.classList.add(s.scrollReveal);observer.observe(el);});
  const reduce=()=>{if(motion.matches){elements.forEach(el=>el.dataset.revealed="true");observer.disconnect();}};motion.addEventListener("change",reduce);
  return()=>{observer.disconnect();motion.removeEventListener("change",reduce);elements.forEach(el=>{el.classList.remove(s.scrollReveal);delete el.dataset.revealed;});};
},[]);return null;}
