"use client";

import { createContext, useContext, type ReactNode } from "react";
import styles from "./store-overview.module.css";

export const DashboardLayoutContext = createContext(false);

/** Both server-rendered layouts are ready before the user toggles the view. */
export function DashboardLayouts({ dashboard, overview }: { dashboard: ReactNode; overview: ReactNode }) {
  const showStores = useContext(DashboardLayoutContext);
  return <div className={styles.stage} data-dashboard-layout={showStores ? "stores" : "dashboard"}>
    <div key={showStores ? "stores" : "dashboard"} className={showStores ? styles.storesEnter : styles.detailEnter}>
      {showStores ? overview : dashboard}
    </div>
  </div>;
}
