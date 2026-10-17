import type { ComponentProps } from "react";
import { usePageState } from "../contexts/PageStateContext";

export function RememberedDetails({ stateKey, open: initialOpen = false, onToggle, ...props }:
  ComponentProps<"details"> & { stateKey: string }) {
  const [open, setOpen] = usePageState(`details.${stateKey}`, initialOpen);
  return <details {...props} open={open} onToggle={event => {
    setOpen(event.currentTarget.open);
    onToggle?.(event);
  }} />;
}
