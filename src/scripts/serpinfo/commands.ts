import * as csstree from "css-tree";
import punycode from "punycode/";
import { z } from "zod";
import { tupleWithOptional } from "zod-tuple-with-optional";
import { css, glob } from "../styles.ts";
import * as C from "./constants.ts";
import { discriminatedTupleUnion } from "./discriminated-tuple-union.ts";

type ExtractArgs<C, K> = C extends [K, ...infer Args] ? Args : never;

const selectorSchema = z.string().refine(
  (value) => {
    try {
      csstree.parse(value, { context: "selectorList" });
      return true;
    } catch {
      return false;
    }
  },
  { message: "Invalid selector" },
);

export type ElementCommand =
  | ["id", ElementCommand?]
  | ["or", ElementCommand[], ElementCommand?]
  | ["selector", string, ElementCommand?]
  | ["upward", number | string, ElementCommand?]
  | string;

export const elementCommandSchema: z.ZodType<ElementCommand> =
  discriminatedTupleUnion([
    tupleWithOptional([
      z.literal("id"),
      z.lazy(() => elementCommandSchema).optional(),
    ]),
    tupleWithOptional([
      z.literal("or"),
      z.lazy(() => elementCommandSchema).array(),
      z.lazy(() => elementCommandSchema).optional(),
    ]),
    tupleWithOptional([
      z.literal("selector"),
      selectorSchema,
      z.lazy(() => elementCommandSchema).optional(),
    ]),
    tupleWithOptional([
      z.literal("upward"),
      z.number().or(z.string()),
      z.lazy(() => elementCommandSchema).optional(),
    ]),
  ]).or(selectorSchema);

export type ElementCommandContext = { root: Element };

type ElementCommandImpl = {
  [K in Exclude<ElementCommand, string>[0]]: (
    context: ElementCommandContext,
    ...args: ExtractArgs<ElementCommand, K>
  ) => Element | null;
};

const elementCommandImpl: ElementCommandImpl = {
  id(context, rootCommand) {
    return getRoot(context, rootCommand);
  },
  or(context, commands, rootCommand) {
    const root = getRoot(context, rootCommand);
    if (root == null) {
      return null;
    }
    for (const command of commands) {
      const element = runElementCommand({ root }, command);
      if (element) {
        return element;
      }
    }
    return null;
  },
  selector(context, selector, rootCommand) {
    const root = getRoot(context, rootCommand);
    if (root == null) {
      return null;
    }
    return root.querySelector(selector);
  },
  upward(context, levelOrSelector, rootCommand) {
    const root = getRoot(context, rootCommand);
    if (root == null) {
      return null;
    }
    if (typeof levelOrSelector === "number") {
      let parent: Element | null = root;
      for (let i = 0; i < levelOrSelector; ++i) {
        parent = parent.parentElement;
        if (parent == null) {
          return null;
        }
      }
      return parent;
    }
    const parent = root.parentElement;
    if (parent == null) {
      return null;
    }
    return parent.closest(levelOrSelector);
  },
};

function getRoot(
  context: ElementCommandContext,
  rootCommand?: ElementCommand,
): Element | null {
  return rootCommand != null
    ? runElementCommand(context, rootCommand)
    : context.root;
}

export function runElementCommand(
  context: ElementCommandContext,
  command: ElementCommand,
): Element | null {
  if (command == null) {
    return context.root;
  }
  if (typeof command === "string") {
    return elementCommandImpl.selector(context, command);
  }
  const [type, ...args] = command;
  return (
    elementCommandImpl[type] as (
      context: ElementCommandContext,
      ...args: readonly unknown[]
    ) => Element | null
  )(context, ...args);
}

export type RootsCommand =
  | ["map", ElementCommand, RootsCommand]
  | ["selector", string]
  | string;

export const RootsCommandSchema: z.ZodType<RootsCommand> =
  discriminatedTupleUnion([
    z.tuple([
      z.literal("map"),
      elementCommandSchema,
      z.lazy(() => RootsCommandSchema),
    ]),
    z.tuple([z.literal("selector"), selectorSchema]),
  ]).or(selectorSchema);

type RootsCommandImpl = {
  [K in Exclude<RootsCommand, string>[0]]: (
    ...args: ExtractArgs<RootsCommand, K>
  ) => Element[];
};

const rootCommandImpl: RootsCommandImpl = {
  map(elementCommand, command) {
    return runRootsCommand(command).flatMap(
      (root) => runElementCommand({ root }, elementCommand) || [],
    );
  },
  selector(selector) {
    return [...document.body.querySelectorAll(selector)];
  },
};

export function runRootsCommand(command: RootsCommand): Element[] {
  if (typeof command === "string") {
    return rootCommandImpl.selector(command);
  }
  const [type, ...args] = command;
  return (rootCommandImpl[type] as (...args: readonly unknown[]) => Element[])(
    ...args,
  );
}

export type PropertyCommand =
  | ["attribute", string, ElementCommand?]
  | ["domainToURL", PropertyCommand]
  | ["jsonItem", string, PropertyCommand]
  | ["or", PropertyCommand[], ElementCommand?]
  | ["property", string, ElementCommand?]
  | ["string", string]
  | ["urlQueryParameter", string, PropertyCommand]
  | string;

export const propertyCommandSchema: z.ZodType<PropertyCommand> =
  discriminatedTupleUnion([
    tupleWithOptional([
      z.literal("attribute"),
      z.string(),
      elementCommandSchema.optional(),
    ]),
    z.tuple([z.literal("domainToURL"), z.lazy(() => propertyCommandSchema)]),
    z.tuple([
      z.literal("jsonItem"),
      z.string(),
      z.lazy(() => propertyCommandSchema),
    ]),
    tupleWithOptional([
      z.literal("or"),
      z.lazy(() => propertyCommandSchema).array(),
      elementCommandSchema.optional(),
    ]),
    tupleWithOptional([
      z.literal("property"),
      z.string(),
      elementCommandSchema.optional(),
    ]),
    z.tuple([z.literal("string"), z.string()]),
    z.tuple([
      z.literal("urlQueryParameter"),
      z.string(),
      z.lazy(() => propertyCommandSchema),
    ]),
  ]).or(selectorSchema);

export type PropertyCommandContext = ElementCommandContext & { url: boolean };

type PropertyCommandImpl = {
  [K in Exclude<PropertyCommand, string>[0]]: (
    context: PropertyCommandContext,
    ...args: ExtractArgs<PropertyCommand, K>
  ) => string | null;
};

const propertyCommandImpl: PropertyCommandImpl = {
  attribute(context, name, rootCommand) {
    const root = getRoot(context, rootCommand);
    if (root == null) {
      return null;
    }
    return root.getAttribute(name);
  },
  domainToURL(context, command) {
    const text = runPropertyCommand(context, command);
    if (text == null) {
      return null;
    }
    // https://stackoverflow.com/questions/47514123/domain-name-regex-including-idn-characters-c-sharp
    const m = /(?:[\p{L}\p{N}][\p{L}\p{N}_-]*\.)+[\p{L}\p{N}]{2,}/u.exec(text);
    if (m == null) {
      return null;
    }
    return `https://${punycode.toASCII(m[0])}/`;
  },
  jsonItem(context, name, command) {
    const json = runPropertyCommand(context, command);
    if (json == null) {
      return null;
    }
    try {
      const object = JSON.parse(json) as unknown;
      if (object == null || typeof object !== "object") {
        return null;
      }
      const value = (object as Record<string, unknown>)[name];
      return typeof value === "string" ? value : null;
    } catch {
      return null;
    }
  },
  or(context, commands) {
    for (const command of commands) {
      const property = runPropertyCommand(context, command);
      if (property != null) {
        return property;
      }
    }
    return null;
  },
  property(context, name, rootCommand) {
    const root = getRoot(context, rootCommand);
    if (root == null) {
      return null;
    }
    const value = (root as unknown as Record<string, unknown>)[name];
    return typeof value === "string" ? value : null;
  },
  string(_context, string) {
    return string;
  },
  urlQueryParameter(context, name, command) {
    const url = runPropertyCommand(context, command);
    if (url == null) {
      return null;
    }
    try {
      return new URL(url, window.location.href).searchParams.get(name);
    } catch {
      return null;
    }
  },
};

export function runPropertyCommand(
  context: PropertyCommandContext,
  command: PropertyCommand,
): string | null {
  if (typeof command === "string") {
    return propertyCommandImpl.property(
      context,
      context.url ? "href" : "textContent",
      command,
    );
  }
  const [type, ...args] = command;
  return (
    propertyCommandImpl[type] as (
      context: PropertyCommandContext,
      ...args: readonly unknown[]
    ) => string | null
  )(context, ...args);
}

export type ButtonCommand = z.infer<typeof buttonCommandSchema>;

const cssLengthPercentageSchema = z.literal(0).or(z.string());

export const buttonCommandSchema = discriminatedTupleUnion([
  tupleWithOptional([
    z.literal("inset"),
    z.object({
      top: cssLengthPercentageSchema.optional(),
      right: cssLengthPercentageSchema.optional(),
      bottom: cssLengthPercentageSchema.optional(),
      left: cssLengthPercentageSchema.optional(),
      zIndex: z.number().optional(),
    }),
    elementCommandSchema.optional(),
  ]),
]);

export type ButtonCommandContext = ElementCommandContext & {
  iconSource: string;
  iconSize: number;
  onClick: () => void;
};

type ButtonCommandImpl = {
  [K in Exclude<ButtonCommand, string>[0]]: (
    context: ButtonCommandContext,
    ...args: ExtractArgs<ButtonCommand, K>
  ) => (() => void) | null;
};

const buttonCommandImpl: ButtonCommandImpl = {
  inset(context, options, rootCommand) {
    const BUTTON_PARENT_ATTRIBUTE = "data-ub-button-parent";

    const parent = getRoot(context, rootCommand);
    if (parent == null) {
      return null;
    }

    glob({ [`[${BUTTON_PARENT_ATTRIBUTE}]`]: { position: "relative" } });
    parent.setAttribute(BUTTON_PARENT_ATTRIBUTE, "1");

    const button = document.createElement("button");
    button.type = "button";
    button.className = css({
      background: "transparent",
      border: "none",
      cursor: "pointer",
      padding: "12px",
      position: "absolute",
      zIndex: 1,
      ...options,
    });
    button.setAttribute(C.BUTTON_ATTRIBUTE, "1");
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      context.onClick();
    });

    const icon = document.createElement("img");
    icon.src = context.iconSource;
    icon.width = context.iconSize;
    icon.height = context.iconSize;

    button.appendChild(icon);
    parent.appendChild(button);

    return () => {
      parent.removeChild(button);
      parent.removeAttribute(BUTTON_PARENT_ATTRIBUTE);
    };
  },
};

export function runButtonCommand(
  context: ButtonCommandContext,
  command: ButtonCommand,
): (() => void) | null {
  const [type, ...args] = command;
  return (
    buttonCommandImpl[type] as (
      context: ButtonCommandContext,
      ...args: readonly unknown[]
    ) => (() => void) | null
  )(context, ...args);
}
