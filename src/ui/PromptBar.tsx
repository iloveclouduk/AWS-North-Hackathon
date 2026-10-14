import { useState } from "react";
import {
  grantLookout,
  startConsoleCopilot,
  stopConsoleCopilot,
  submitPrompt,
  type Layout,
} from "@/app/runtime";
import { useCity } from "@/state/store";
import { feel } from "./feedback";
import { Icon } from "./icons";
import { offlineReason } from "./logic";

/**
 * The composer: one row that never crowds the panel. In the side panel, the console button switches the
 * prompt to the Console Copilot (the agent works in your open AWS console tab).
 */
export function PromptBar({ layout }: { layout: Layout }) {
  const [text, setText] = useState("");
  const [inConsole, setInConsole] = useState(false);
  /** Counts sends; the Send icon re-mounts on each one so its little hop replays. */
  const [sent, setSent] = useState(0);
  const onConsole = useCity(
    (s) => s.focus?.kind === "console" || s.focus?.kind === "console-home",
  );
  const copilotOn = useCity((s) => !!s.copilotTaskId);
  const needsCamera = useCity((s) => s.snap === "needs-permission");
  const offline = useCity((s) => offlineReason(s.backendKind, s.backendStatus));
  const send = () => {
    if (!text.trim() || offline) return;
    feel.send();
    if (inConsole) void startConsoleCopilot(text);
    else submitPrompt(text);
    setText("");
    setSent((n) => n + 1);
  };
  const consoleTitle = inConsole
    ? "Console Copilot on: the agent works in your AWS console tab"
    : onConsole
      ? "Do it in my AWS console tab"
      : "Do it in my AWS console (open a console tab first)";
  return (
    <>
      {/* Say the mode out loud (not only in a tooltip), and why sending is off. */}
      {inConsole && (
        <p className="composer-note on" role="status">
          🖱️ <b>Console Copilot is on.</b> The agent clicks through your AWS
          console tab, and asks before it changes anything.
        </p>
      )}
      {offline && <p className="composer-note">{offline}</p>}
      <form
        className={`composer ${inConsole ? "console-mode" : ""}`}
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        {layout === "panel" && (
          <button
            type="button"
            className={`btn icon ghost console-btn ${inConsole ? "on" : ""}`}
            aria-pressed={inConsole}
            title={consoleTitle}
            aria-label={consoleTitle}
            onClick={() => setInConsole((v) => !v)}
          >
            <Icon name="console" />
          </button>
        )}
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={
            inConsole
              ? "What should I do in your console?"
              : "Ask the city to do something…"
          }
          aria-label={
            inConsole
              ? "What should the agent do in your console?"
              : "Ask the city"
          }
        />
        {needsCamera && (
          <button
            type="button"
            className="btn tiny"
            onClick={grantLookout}
            title="Chrome needs your OK before the Lookout can see pages"
          >
            <Icon name="camera" size={10} /> Allow
          </button>
        )}
        {copilotOn && (
          <button
            type="button"
            className="btn tiny warn"
            onClick={() => stopConsoleCopilot("You stopped the Console Copilot.")}
          >
            Stop
          </button>
        )}
        <button
          className="btn icon primary send"
          type="submit"
          disabled={!text.trim() || !!offline}
          title={offline ?? "Send"}
          aria-label="Send"
        >
          <span key={sent} className={sent ? "hop" : undefined}>
            <Icon name="send" />
          </span>
        </button>
      </form>
    </>
  );
}
