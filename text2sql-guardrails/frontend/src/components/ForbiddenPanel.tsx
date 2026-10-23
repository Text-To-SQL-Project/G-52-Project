import { LockKeyhole } from "lucide-react";
import { Callout } from "./kit";

export function ForbiddenPanel({ what }: { what: string }) {
  return (
    <Callout icon={LockKeyhole} tone="muted" title="Administrator access required">
      <p className="max-w-prose">
        Your account is not permitted to view {what}. If your role changed recently, sign out and back in to
        refresh this view.
      </p>
    </Callout>
  );
}
