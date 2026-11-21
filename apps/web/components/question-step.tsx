"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { ANSWER_MAX, ASAP_LABEL, parseSlotKey, slotKey, slotsLabel, type Answer, type Step, type TimeSlot, type WhenCalendar } from "@legwork/shared";
import { currentSuburb, geoPermission, lastSuburb, LocationError, planWhere, type GeoPermission } from "@/lib/location";
import { MicButton, useDictation } from "./dictation";
import { buttonPrimary, fieldClass, Icon, icons } from "./ui";
import { WhenCalendarPicker, type WhenPick } from "./when-calendar";

type Props = {
  step: Step;
  /** The earlier answer, when the customer came back to change it. */
  initial?: Answer;
  onAnswer: (answer: string | string[]) => void;
};

/**
 * Moves focus to `ref` when it mounts (#70), so a new question (after an
 * answer, Back or Edit) or a failure is where a keyboard or screen reader
 * user lands. It only takes focus that was dropped: when the last control was
 * removed with the old question, or it was a button in the flow. Someone
 * typing, choosing a file or using the header keeps their place, and an input
 * the question focused itself (a text answer) is left alone.
 */
export function useFocusOnMount(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const active = document.activeElement as HTMLElement | null;
    if (active && active !== document.body) {
      if (!active.closest("main")) return;
      if (active.closest("input, textarea, select, [contenteditable]")) return;
    }
    el.focus();
  }, [ref]);
}

/** The question's prompt. Focused when the question appears, and it names the answer controls. */
export function QuestionHeading({ id, className, children }: { id: string; className?: string; children: ReactNode }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useFocusOnMount(ref);
  return (
    <h1
      id={id}
      ref={ref}
      tabIndex={-1}
      className={`rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-selected ${className ?? ""}`}
    >
      {children}
    </h1>
  );
}

/**
 * A polite live region that is always in the page, so a message that appears
 * later (a save or location error) is announced without taking focus.
 */
export function LiveMessage({ className, children }: { className?: string; children?: ReactNode }) {
  return (
    <p role="status" aria-live="polite" className={children ? className : "sr-only"}>
      {children}
    </p>
  );
}

/** Grows a textarea to fit what's typed. */
function useAutosize(value: string) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return ref;
}

function TextAnswer({
  label,
  placeholder,
  initial = "",
  autoFocus = true,
  onSubmit,
}: {
  /** The accessible name: the question's prompt, or what this box is for. */
  label: string;
  placeholder: string | null;
  initial?: string;
  autoFocus?: boolean;
  onSubmit: (text: string) => void;
}) {
  const [value, setValue] = useState(initial);
  const ref = useAutosize(value);
  const trimmed = value.trim();
  const dictation = useDictation((text) => setValue(text.slice(0, ANSWER_MAX)));
  const submit = () => {
    dictation.stop();
    if (trimmed) onSubmit(trimmed);
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="space-y-3"
    >
      <label htmlFor="answer" className="sr-only">
        {label}
      </label>
      <textarea
        id="answer"
        ref={ref}
        rows={2}
        autoFocus={autoFocus}
        value={value}
        maxLength={ANSWER_MAX}
        placeholder={placeholder ?? "Type your answer"}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          }
        }}
        className={`${fieldClass} max-h-60 min-h-[88px] resize-none ${dictation.error ? "is-error" : ""}`}
      />
      <LiveMessage className="lw-error-note">{dictation.error}</LiveMessage>
      <div className="flex items-center justify-end gap-2">
        {dictation.supported && (
          <MicButton
            listening={dictation.listening}
            busy={dictation.busy}
            onClick={() => (dictation.listening ? dictation.stop() : dictation.start(value))}
            className="mr-auto"
          />
        )}
        <button type="submit" disabled={!trimmed} className={`${buttonPrimary} flex-1`}>
          Continue
          <Icon name={icons.arrow} className="size-4.5" />
        </button>
      </div>
    </form>
  );
}

const optionClass = (selected: boolean) =>
  `lw-glass lw-option lw-press flex min-h-14 w-full items-center gap-3 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-selected ${
    selected ? "is-selected" : ""
  }`;

/** Right-hand mark: a radio (yellow with an ink check once picked). Square for multi choice. */
function Badge({ selected, square }: { n: number; selected: boolean; square: boolean }) {
  return (
    <span aria-hidden className={`lw-radio ${square ? "lw-radio--square" : ""} ${selected ? "is-on" : ""}`}>
      {selected && <Icon name={icons.check} className="size-3.5" />}
    </span>
  );
}

function SomethingElse({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="lw-link inline-flex min-h-11 items-center px-1"
    >
      Something else? Type it
    </button>
  );
}

/** Number keys 1-9 pick an option, unless the customer is typing somewhere. */
function useNumberKeys(count: number, onPick: (index: number) => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable]")) return;
      const n = Number(e.key);
      if (Number.isInteger(n) && n >= 1 && n <= Math.min(count, 9)) {
        e.preventDefault();
        onPick(n - 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [count, onPick]);
}

function ChoiceAnswer({ step, initial, onAnswer }: Props) {
  const previous = typeof initial === "string" ? initial : null;
  const previousIsOther = previous !== null && !step.options.includes(previous);
  const [other, setOther] = useState(previousIsOther);
  const [picked, setPicked] = useState<string | null>(null);
  const shown = picked ?? (previousIsOther ? null : previous);

  // Show the choice for a beat before moving on, so the click registers.
  const pick = useCallback(
    (option: string) => {
      if (picked) return;
      setPicked(option);
      setTimeout(() => onAnswer(option), 160);
    },
    [picked, onAnswer],
  );
  useNumberKeys(step.options.length, (i) => pick(step.options[i]!));

  return (
    <div className="flex flex-col gap-2.5" role="radiogroup" aria-label={step.prompt}>
      {step.options.map((option, i) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={shown === option}
          onClick={() => pick(option)}
          className={optionClass(shown === option)}
        >
          <span className="lw-headline min-w-0 flex-1">{option}</span>
          <Badge n={i + 1} selected={shown === option} square={false} />
        </button>
      ))}
      <div className="pt-2">
        {step.section === "when" ? null : other ? (
          <TextAnswer
            label={`${step.prompt} In your own words`}
            placeholder="Describe it in your own words"
            initial={previousIsOther ? previous : ""}
            onSubmit={onAnswer}
          />
        ) : (
          <SomethingElse onOpen={() => setOther(true)} />
        )}
      </div>
    </div>
  );
}

/** The earlier answer to "How soon?" as a pick, when the customer came back to change it. */
function initialPick(initial: Answer | undefined): WhenPick {
  if (Array.isArray(initial)) return { asap: false, slots: initial.map(parseSlotKey).filter((x): x is TimeSlot => x !== null) };
  return { asap: typeof initial === "string" && /^asap\b/i.test(initial), slots: [] };
}

/**
 * "How soon?" (#65): ASAP, or any number of blocks on a small calendar of the
 * days somebody is free. The pick reads back in one line above the button.
 */
function WhenAnswer({
  prompt,
  calendar,
  initial,
  onAnswer,
}: {
  prompt: string;
  calendar: WhenCalendar;
  initial?: Answer;
  onAnswer: Props["onAnswer"];
}) {
  const [pick, setPick] = useState<WhenPick>(() => initialPick(initial));
  const ready = pick.asap || pick.slots.length > 0;
  const summary = pick.asap ? "ASAP" : pick.slots.length > 0 ? slotsLabel(pick.slots, Date.now(), calendar.timeZone) : "Pick ASAP, or any times that suit";
  return (
    <div className="space-y-3" role="group" aria-label={prompt}>
      <WhenCalendarPicker calendar={calendar} value={pick} onChange={setPick} />
      <div className="space-y-2">
        <p className={`lw-subhead truncate text-center ${ready ? "font-semibold text-ink" : "text-muted"}`} aria-live="polite">
          {summary}
        </p>
        <button
          type="button"
          disabled={!ready}
          onClick={() => onAnswer(pick.asap ? ASAP_LABEL : pick.slots.map(slotKey))}
          className={`${buttonPrimary} w-full`}
        >
          Continue
          <Icon name={icons.arrow} className="size-4.5" />
        </button>
      </div>
    </div>
  );
}

function MultiChoiceAnswer({ step, initial, onAnswer }: Props) {
  const previous = Array.isArray(initial) ? initial : [];
  const [selected, setSelected] = useState<string[]>(() => previous.filter((a) => step.options.includes(a)));
  const [other, setOther] = useState<string | null>(() => {
    const extra = previous.filter((a) => !step.options.includes(a));
    return extra.length > 0 ? extra.join(", ") : null;
  });
  const answers = [...selected, ...(other?.trim() ? [other.trim()] : [])];
  const toggle = useCallback(
    (option: string) => setSelected((s) => (s.includes(option) ? s.filter((o) => o !== option) : [...s, option])),
    [],
  );
  useNumberKeys(step.options.length, (i) => toggle(step.options[i]!));

  return (
    <div className="flex flex-col gap-2.5" role="group" aria-label={step.prompt} aria-describedby="pick-all">
      <p id="pick-all" className="lw-footnote px-1 text-faint">Pick all that apply.</p>
      {step.options.map((option, i) => {
        const isSelected = selected.includes(option);
        return (
          <button
            key={option}
            type="button"
            role="checkbox"
            aria-checked={isSelected}
            onClick={() => toggle(option)}
            className={optionClass(isSelected)}
          >
            <span className="lw-headline min-w-0 flex-1">{option}</span>
            <Badge n={i + 1} selected={isSelected} square />
          </button>
        );
      })}
      <div className="pt-2">
        {other === null ? (
          <SomethingElse onOpen={() => setOther("")} />
        ) : (
          <>
            <label htmlFor="other" className="sr-only">
              {`${step.prompt} Something else`}
            </label>
            <input
              id="other"
              autoFocus
              value={other}
              maxLength={200}
              placeholder="Something else"
              onChange={(e) => setOther(e.target.value)}
              className={fieldClass}
            />
          </>
        )}
      </div>
      <div className="pt-2">
        <button type="button" disabled={answers.length === 0} onClick={() => onAnswer(answers)} className={`${buttonPrimary} w-full`}>
          Continue
          <Icon name={icons.arrow} className="size-4.5" />
        </button>
      </div>
    </div>
  );
}

/**
 * Speaks `text` from a polite live region kept in the page body, so the
 * message is still heard after this question is replaced by the next one.
 */
function useAnnouncer() {
  const region = useRef<HTMLElement | null>(null);
  useEffect(() => {
    let el = document.getElementById("announcer");
    if (!el) {
      el = document.createElement("div");
      el.id = "announcer";
      el.setAttribute("role", "status");
      el.setAttribute("aria-live", "polite");
      el.className = "sr-only";
      document.body.append(el);
    }
    el.textContent = "";
    region.current = el;
  }, []);
  return useCallback((text: string) => {
    if (region.current) region.current.textContent = text;
  }, []);
}

const linkClass = "lw-link inline-flex min-h-11 items-center px-1 disabled:opacity-60";

/**
 * The "where" question (#95). When the browser already lets us see where they
 * are, it answers itself: the suburb is posted with no tap. Otherwise one
 * primary choice (the last suburb, else "Use my current location") and the
 * other routes as text links. It never asks for location on load.
 */
function LocationAnswer({ step, initial, onAnswer }: Props) {
  const earlier = typeof initial === "string" && initial.trim() ? initial : null;
  const [last] = useState(() => earlier ?? lastSuburb());
  const [permission, setPermission] = useState<GeoPermission | null>(null);
  const [failed, setFailed] = useState(false);
  const [typingAsked, setTypingAsked] = useState(false);
  const [locating, setLocating] = useState(false);
  const [found, setFound] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const done = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const announce = useAnnouncer();

  const plan = permission ? planWhere({ permission, last, changing: earlier !== null, failed }) : null;
  const typing = typingAsked || !!plan?.typing;

  const finish = useCallback(
    (answer: string) => {
      if (done.current) return;
      done.current = true;
      onAnswer(answer);
    },
    [onAnswer],
  );

  const locate = useCallback(
    async (silent: boolean, isLive: () => boolean = () => true) => {
      setLocating(true);
      setError(null);
      try {
        const suburb = await currentSuburb();
        if (!isLive() || done.current) return;
        if (silent) {
          // Show and say what we did for a beat, then move on as if they'd tapped it.
          setFound(suburb);
          announce(`Using your location: ${suburb}`);
          timer.current = setTimeout(() => finish(suburb), 700);
        } else {
          finish(suburb);
        }
      } catch (e) {
        if (!isLive() || done.current) return;
        setError(e instanceof LocationError ? e.message : "We couldn't find where you are.");
        setFailed(true);
      } finally {
        if (isLive()) setLocating(false);
      }
    },
    [announce, finish],
  );

  // Read the permission without asking for it.
  useEffect(() => {
    let live = true;
    void geoPermission().then((p) => live && setPermission(p));
    return () => {
      live = false;
    };
  }, []);

  // Already allowed: find the suburb and post it, no tap.
  const auto = !!plan?.auto && !typingAsked;
  useEffect(() => {
    if (!auto) return;
    let live = true;
    void locate(true, () => live);
    return () => {
      live = false;
      setLocating(false);
    };
  }, [auto, locate]);

  const pick = (answer: string) => {
    setTypingAsked(false);
    finish(answer);
  };
  const lastButton = last && (
    <button type="button" onClick={() => pick(last)} className={`${buttonPrimary} w-full justify-center`}>
      <Icon name={icons.pin} className="size-5" />
      {last}
    </button>
  );
  const locateButton = (
    <button
      type="button"
      onClick={() => (found ? finish(found) : void locate(false))}
      disabled={locating && !found}
      className={`${buttonPrimary} w-full justify-center`}
    >
      <Icon name={icons.locate} className="size-5" />
      {found ?? (locating ? "Finding you…" : "Use my current location")}
    </button>
  );
  const links = (plan?.links ?? []).filter((r) => !(r === "type" && typing) && !(auto && r === "locate"));
  const fallback = last ? `Use ${last}, or type the suburb.` : "Type the suburb instead.";

  return (
    <div className="flex flex-col gap-2.5" role="group" aria-label={step.prompt} aria-describedby="where-privacy" aria-busy={!plan}>
      <LiveMessage className="sr-only">{locating && !found ? "Finding where you are…" : null}</LiveMessage>
      {plan && (auto ? locateButton : plan.primary === "last" ? lastButton : plan.primary === "locate" ? locateButton : null)}
      <LiveMessage className="lw-error-note">{error && `${error} ${fallback}`}</LiveMessage>
      {typing && (
        <TextAnswer label={`${step.prompt} Suburb`} placeholder={step.placeholder} initial="" autoFocus onSubmit={pick} />
      )}
      {links.length > 0 && !found && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1">
          {links.map((route) =>
            route === "last" ? (
              <button key={route} type="button" onClick={() => pick(last!)} className={linkClass}>
                Use {last} instead
              </button>
            ) : route === "locate" ? (
              <button key={route} type="button" onClick={() => void locate(false)} disabled={locating} className={linkClass}>
                {locating ? "Finding you…" : "Use my current location"}
              </button>
            ) : (
              <button key={route} type="button" onClick={() => setTypingAsked(true)} className={linkClass}>
                Somewhere else? Type the suburb
              </button>
            ),
          )}
        </div>
      )}
      <p id="where-privacy" className="lw-caption px-1 pt-1 text-muted">
        The Pro gets the suburb, not your address.
      </p>
    </div>
  );
}

/** Answer input for choice, multi choice and text questions. */
export function QuestionStep(props: Props) {
  if (props.step.section === "where") return <LocationAnswer {...props} />;
  if (props.step.section === "when" && props.step.calendar) {
    return <WhenAnswer prompt={props.step.prompt} calendar={props.step.calendar} initial={props.initial} onAnswer={props.onAnswer} />;
  }
  switch (props.step.type) {
    case "choice":
      return <ChoiceAnswer {...props} />;
    case "multi_choice":
      return <MultiChoiceAnswer {...props} />;
    default:
      return (
        <TextAnswer
          label={props.step.prompt}
          placeholder={props.step.placeholder}
          initial={typeof props.initial === "string" ? props.initial : ""}
          onSubmit={props.onAnswer}
        />
      );
  }
}
