import { useEffect, useState } from "react";
import { type Action } from "@mandate/shared";
import { getActions, getApprovals } from "../lib/api";
import { connectTimeline } from "../lib/sse";

import { errorText } from "./shared";

export function useActionFeed(personaId: string, approvalsOnly: boolean, refreshKey: number) {
  const [actions, setActions] = useState<Action[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    const load = approvalsOnly ? getApprovals(personaId, controller.signal) : getActions(personaId, 100, controller.signal);
    load.then((items) => {
      setActions(items);
      setError("");
    }, (caught: unknown) => {
      if (!controller.signal.aborted) setError(errorText(caught, "Couldn't load actions."));
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    const close = connectTimeline(personaId, (action) => {
      setActions((current) => [action, ...current.filter((item) => item.id !== action.id)].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    }, (caught) => setError(errorText(caught, "Live activity disconnected. Reconnecting…")));
    return () => { controller.abort(); close(); };
  }, [personaId, approvalsOnly, refreshKey]);
  return { actions, setActions, loading, error };
}
