// T1.9M: extension price for the purchase dialogs, loaded once per app session.
import { useEffect, useState } from "react";
import { fetchReactivationPrice } from "./reportLifecycle";

let cached: number | null = null;

export function useReactivationPrice(): number | null {
  const [price, setPrice] = useState<number | null>(cached);
  useEffect(() => {
    if (cached != null) return;
    let live = true;
    void fetchReactivationPrice().then((value) => {
      if (value != null) cached = value;
      if (live) setPrice(value);
    });
    return () => {
      live = false;
    };
  }, []);
  return price;
}
