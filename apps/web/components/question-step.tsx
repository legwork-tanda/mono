"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ANSWER_MAX, type Answer, type Step } from "@legwork/shared";
import { currentSuburb, LocationError } from "@/lib/location";
import { MicButton, useDictation } from "./dictation";
import { buttonPrimary, fieldClass, Icon, icons } from "./ui";

type Props = {
  step: Step;
  /** The earlier answer, when the customer came back to change it. */
  initial?: Answer;
  onAnswer: (answer: string | string[]) => void;
};

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
  placeholder,
  initial = "",
  autoFocus = true,
  onSubmit,
}: {
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
        Your answer
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
        className={`${fieldClass} max-h-60 resize-none text-lg`}
      />
      {dictation.error && <p className="text-sm text-danger">{dictation.error}</p>}
      <div className="flex items-center justify-end gap-2">
        {dictation.supported && (
          <MicButton
            listening={dictation.listening}
            busy={dictation.busy}
            onClick={() => (dictation.listening ? dictation.stop() : dictation.start(value))}
            className="mr-auto"
          />
        )}
        <button type="submit" disabled={!trimmed} className={buttonPrimary}>
          Continue
          <Icon d={icons.arrow} className="size-4.5" />
        </button>
      </div>
    </form>
  );
}

const optionClass = (selected: boolean) =>
  `group flex min-h-13 w-full items-center gap-3 rounded-[14px] border px-3.5 py-3 text-left text-base transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
    selected ? "border-brand bg-brand-soft text-ink" : "border-line bg-white hover:border-brand/50 hover:bg-drop"
  }`;

/** Left badge: the option's number key, or a tick once picked. Square for multi choice. */
function Badge({ n, selected, square }: { n: number; selected: boolean; square: boolean }) {
  return (
    <span
      aria-hidden
      className={`flex size-7 shrink-0 items-center justify-center border text-xs font-semibold transition-colors duration-150 ${
        square ? "rounded-md" : "rounded-full"
      } ${selected ? "border-brand bg-brand text-white" : "border-line bg-white text-faint group-hover:border-brand/40 group-hover:text-brand"}`}
    >
      {selected ? <Icon d={icons.check} className="size-4 stroke-[2.5]" /> : n <= 9 ? n : ""}
    </span>
  );
}

function SomethingElse({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="rounded-md px-1 text-sm font-semibold text-brand hover:text-brand-strong focus-visible:outline-2 focus-visible:outline-brand"
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
    <div className="space-y-2.5" role="radiogroup" aria-label={step.prompt}>
      {step.options.map((option, i) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={shown === option}
          onClick={() => pick(option)}
          className={optionClass(shown === option)}
        >
          <Badge n={i + 1} selected={shown === option} square={false} />
          {option}
        </button>
      ))}
      <div className="pt-2">
        {step.section === "when" ? (
          step.dates && <PickDate range={step.dates} initial={previousIsOther ? previous : null} onPick={onAnswer} />
        ) : other ? (
          <TextAnswer
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

/**
 * The "How soon?" fallback when none of the dated options suit: a native date
 * picker, which answers with the picked day (YYYY-MM-DD) as soon as it's set.
 */
function PickDate({ range, initial, onPick }: { range: { min: string; max: string }; initial: string | null; onPick: (date: string) => void }) {
  const [open, setOpen] = useState(initial !== null);
  const [value, setValue] = useState(initial ?? "");
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md px-1 text-sm font-semibold text-brand hover:text-brand-strong focus-visible:outline-2 focus-visible:outline-brand"
      >
        Another day? Pick a date
      </button>
    );
  }
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (value) onPick(value);
      }}
    >
      <label htmlFor="when-date" className="sr-only">
        Pick a date
      </label>
      <input
        id="when-date"
        type="date"
        autoFocus
        min={range.min}
        max={range.max}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className={fieldClass}
      />
      <button type="submit" disabled={!value} className={`${buttonPrimary} h-12 shrink-0`}>
        Continue
        <Icon d={icons.arrow} className="size-4.5" />
      </button>
    </form>
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
    <div className="space-y-2.5">
      <p className="text-sm text-muted">Pick all that apply.</p>
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
            <Badge n={i + 1} selected={isSelected} square />
            {option}
          </button>
        );
      })}
      <div className="pt-2">
        {other === null ? (
          <SomethingElse onOpen={() => setOther("")} />
        ) : (
          <>
            <label htmlFor="other" className="sr-only">
              Something else
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
      <div className="flex justify-end pt-2">
        <button type="button" disabled={answers.length === 0} onClick={() => onAnswer(answers)} className={buttonPrimary}>
          Continue
          <Icon d={icons.arrow} className="size-4.5" />
        </button>
      </div>
    </div>
  );
}

/**
 * The "where" question: one tap on "Use my current location", or the suburb
 * they used last time. Typing is the fallback, not the default.
 */
function LocationAnswer({ step, initial, onAnswer }: Props) {
  const previous = typeof initial === "string" && initial.trim() ? initial : null;
  const [typing, setTyping] = useState(false);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const locate = async () => {
    if (locating) return;
    setLocating(true);
    setError(null);
    try {
      onAnswer(await currentSuburb());
    } catch (e) {
      setError(e instanceof LocationError ? e.message : "We couldn't find where you are.");
      setTyping(true);
    } finally {
      setLocating(false);
    }
  };

  return (
    <div className="space-y-2.5">
      <button type="button" onClick={locate} disabled={locating} className={`${buttonPrimary} w-full justify-center`}>
        <Icon d={icons.locate} className="size-4.5" />
        {locating ? "Finding you…" : "Use my current location"}
      </button>
      {previous && !locating && (
        <button type="button" onClick={() => onAnswer(previous)} className={optionClass(false)}>
          <Icon d={icons.pin} className="size-5 shrink-0 text-faint" />
          {previous}
        </button>
      )}
      {error && <p className="text-sm text-danger">{error} Type the suburb instead.</p>}
      <div className="pt-2">
        {typing ? (
          <TextAnswer placeholder={step.placeholder} initial="" autoFocus onSubmit={onAnswer} />
        ) : (
          <button
            type="button"
            onClick={() => setTyping(true)}
            className="rounded-md px-1 text-sm font-semibold text-brand hover:text-brand-strong focus-visible:outline-2 focus-visible:outline-brand"
          >
            Somewhere else? Type the suburb
          </button>
        )}
      </div>
    </div>
  );
}

/** Answer input for choice, multi choice and text questions. */
export function QuestionStep(props: Props) {
  if (props.step.section === "where") return <LocationAnswer {...props} />;
  switch (props.step.type) {
    case "choice":
      return <ChoiceAnswer {...props} />;
    case "multi_choice":
      return <MultiChoiceAnswer {...props} />;
    default:
      return (
        <TextAnswer
          placeholder={props.step.placeholder}
          initial={typeof props.initial === "string" ? props.initial : ""}
          onSubmit={props.onAnswer}
        />
      );
  }
}
