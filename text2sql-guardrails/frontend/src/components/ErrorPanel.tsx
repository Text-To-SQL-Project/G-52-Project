import { CircleAlert } from "lucide-react";
import { Callout } from "./kit";

export function ErrorPanel({ message }: { message?: string | null }) {
  return (
    <Callout icon={CircleAlert} tone="muted" title="Something went wrong">
      <p className="break-words">{message ?? "No error detail was returned."}</p>
    </Callout>
  );
}
