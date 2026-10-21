import {
  cloneElement,
  createContext,
  forwardRef,
  isValidElement,
  useContext,
  useId,
  useState,
} from "react";
import type { ComponentPropsWithoutRef, MouseEvent, ReactElement, ReactNode } from "react";

function joinClasses(...values: Array<string | undefined | false>): string {
  return values.filter(Boolean).join(" ");
}

interface SidebarContextValue {
  /** Whether the rail is currently collapsed to icons only. */
  collapsed: boolean;
  /** Flip the rail; respects controlled mode and reports the next value. */
  toggle: () => void;
}

const SidebarContext = createContext<SidebarContextValue>({
  collapsed: false,
  toggle: () => {},
});

const ROOT_CLASSES = [
  "flex h-full flex-col gap-2 border-r border-border bg-surface p-2",
  "text-base text-foreground",
  "transition-[width] duration-[var(--km-duration-short)] ease-continuity",
  "motion-reduce:transition-none",
].join(" ");

const NAV_CLASSES =
  "flex min-h-0 flex-1 flex-col gap-1 overflow-x-hidden overflow-y-auto";

const ITEM_CLASSES = [
  "relative flex w-full items-center gap-3 overflow-hidden rounded-control px-3",
  "h-[var(--km-control-height)] text-sm text-muted-foreground",
  "transition-colors duration-[var(--km-duration-short)] ease-continuity",
  "hover:bg-surface-subtle hover:text-foreground",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
].join(" ");

/**
 * Active items gain a weight change, a filled surface and a leading marker, so
 * the current page is never communicated by colour alone.
 */
const ACTIVE_ITEM_CLASSES = [
  "bg-surface-subtle font-medium text-foreground",
  "before:absolute before:top-1/2 before:left-0 before:h-4 before:w-0.5 before:-translate-y-1/2",
  "before:rounded-full before:bg-foreground before:content-['']",
].join(" ");

const DISABLED_ITEM_CLASSES =
  "cursor-not-allowed text-muted-foreground hover:bg-transparent hover:text-muted-foreground";

const TOGGLE_CLASSES = [
  "inline-flex size-8 shrink-0 items-center justify-center self-end rounded-control",
  "border border-border bg-surface text-muted-foreground",
  "transition-colors duration-[var(--km-duration-short)] ease-continuity",
  "hover:bg-surface-subtle hover:text-foreground active:bg-surface-inset",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
].join(" ");

export interface SidebarProps extends ComponentPropsWithoutRef<"nav"> {
  /**
   * Controlled collapsed state. When provided, the component never changes it
   * on its own and only emits `onCollapsedChange`.
   */
  collapsed?: boolean;
  /** Initial collapsed state when uncontrolled. @default false */
  defaultCollapsed?: boolean;
  /** Called with the next collapsed state whenever `Sidebar.Toggle` is pressed. */
  onCollapsedChange?: (collapsed: boolean) => void;
  /**
   * Accessible name for the navigation landmark. Keep it distinct from other
   * landmarks on the page ("Sidebar", "Documentation", …). @default "Sidebar"
   */
  "aria-label"?: string;
  /** Extra classes merged onto the root `<nav>` (consumer classes last). */
  className?: string;
  /** `Sidebar.Header`, `Sidebar.Nav`, `Sidebar.Footer` and their children. */
  children?: ReactNode;
}

/**
 * Collapsible application navigation rail.
 *
 * Renders a labelled `<nav>` landmark that owns the `collapsed` state and hands
 * it to its parts through context. Collapsing only changes the visual layout:
 * item labels move to `sr-only`, so every link keeps its accessible name and
 * the document stays usable for screen-reader and keyboard users.
 *
 * The rail is router-agnostic — it renders plain `<a href>` elements (or accepts
 * a consumer-rendered anchor as a child), so the consumer supplies URLs, link
 * components and routing behaviour. `Sidebar.Toggle` is an optional part that
 * flips the state; without it, drive `collapsed` from your own control.
 */
const SidebarRoot = forwardRef<HTMLElement, SidebarProps>(function Sidebar(
  {
    collapsed,
    defaultCollapsed = false,
    onCollapsedChange,
    "aria-label": ariaLabel = "Sidebar",
    className,
    children,
    ...props
  },
  ref
) {
  const [uncontrolledCollapsed, setUncontrolledCollapsed] = useState(defaultCollapsed);
  const isControlled = collapsed !== undefined;
  const isCollapsed = isControlled ? collapsed : uncontrolledCollapsed;

  function toggle() {
    const next = !isCollapsed;
    if (!isControlled) setUncontrolledCollapsed(next);
    onCollapsedChange?.(next);
  }

  return (
    <SidebarContext.Provider value={{ collapsed: isCollapsed, toggle }}>
      <nav
        {...props}
        ref={ref}
        aria-label={ariaLabel}
        data-km-sidebar="root"
        data-collapsed={isCollapsed ? "" : undefined}
        className={joinClasses(ROOT_CLASSES, isCollapsed ? "w-16" : "w-64", className)}
      >
        {children}
      </nav>
    </SidebarContext.Provider>
  );
});

SidebarRoot.displayName = "Sidebar";

export interface SidebarHeaderProps extends ComponentPropsWithoutRef<"div"> {
  /** Extra classes merged onto the header region. */
  className?: string;
  /** Brand, workspace switcher or the optional `Sidebar.Toggle`. */
  children?: ReactNode;
}

/** Top region for identity and the collapse control. */
const SidebarHeader = forwardRef<HTMLDivElement, SidebarHeaderProps>(function SidebarHeader(
  { className, children, ...props },
  ref
) {
  return (
    <div
      {...props}
      ref={ref}
      data-km-sidebar="header"
      className={joinClasses("flex shrink-0 flex-col gap-2", className)}
    >
      {children}
    </div>
  );
});

SidebarHeader.displayName = "Sidebar.Header";

export interface SidebarNavProps extends ComponentPropsWithoutRef<"ul"> {
  /** Extra classes merged onto the `<ul>`. */
  className?: string;
  /** `Sidebar.Item` and `Sidebar.Group` children. */
  children?: ReactNode;
}

/** Scrollable list that fills the rail between header and footer. */
const SidebarNav = forwardRef<HTMLUListElement, SidebarNavProps>(function SidebarNav(
  { className, children, ...props },
  ref
) {
  return (
    <ul {...props} ref={ref} data-km-sidebar="nav" className={joinClasses(NAV_CLASSES, className)}>
      {children}
    </ul>
  );
});

SidebarNav.displayName = "Sidebar.Nav";

export interface SidebarGroupProps extends ComponentPropsWithoutRef<"li"> {
  /**
   * Visible section label. It also names the nested list through
   * `aria-labelledby`, and becomes `sr-only` when the rail is collapsed, so the
   * grouping is never lost.
   */
  label?: ReactNode;
  /** Extra classes merged onto the group `<li>`. */
  className?: string;
  /** `Sidebar.Item` children belonging to this group. */
  children?: ReactNode;
}

/**
 * Labelled section inside `Sidebar.Nav`.
 *
 * Renders `<li>` → label + nested `<ul>`, which is valid inside the nav list.
 * Use it as a direct child of `Sidebar.Nav`; items inside it keep their normal
 * tab order.
 */
const SidebarGroup = forwardRef<HTMLLIElement, SidebarGroupProps>(function SidebarGroup(
  { label, className, children, ...props },
  ref
) {
  const { collapsed } = useContext(SidebarContext);
  const labelId = useId();

  return (
    <li
      {...props}
      ref={ref}
      data-km-sidebar="group"
      className={joinClasses("flex min-w-0 flex-col gap-1", className)}
    >
      {label != null ? (
        <span
          id={labelId}
          data-km-sidebar="group-label"
          className={joinClasses(
            "px-3 pt-2 text-caption font-medium tracking-wide text-muted-foreground uppercase",
            collapsed && "sr-only"
          )}
        >
          {label}
        </span>
      ) : null}
      <ul aria-labelledby={label != null ? labelId : undefined} className="flex flex-col gap-1">
        {children}
      </ul>
    </li>
  );
});

SidebarGroup.displayName = "Sidebar.Group";

export interface SidebarItemProps
  extends Omit<ComponentPropsWithoutRef<"a">, "href" | "aria-current"> {
  /** Destination URL. Omit it when you render your own anchor as `children`. */
  href?: string;
  /**
   * Marks the item as the current page: sets `aria-current="page"` and the
   * active surface + marker. @default false
   */
  active?: boolean;
  /** Leading glyph, rendered in an `aria-hidden` box so it never names the link. */
  icon?: ReactNode;
  /**
   * Blocks activation: drops `href`, sets `aria-disabled="true"`, removes the
   * item from the tab order and suppresses `onClick`. @default false
   */
  disabled?: boolean;
  /** Visible label (or a full consumer-rendered `<a>`/router link element). */
  children?: ReactNode;
  /**
   * Extra classes merged onto the link. For a consumer-rendered anchor they are
   * merged before its own `className`, so the consumer still wins.
   */
  className?: string;
}

interface CustomAnchorProps {
  className?: string;
  onClick?: (event: MouseEvent<HTMLAnchorElement>) => void;
  tabIndex?: number;
  "aria-current"?: string;
  "aria-disabled"?: boolean | "true" | "false";
  "data-km-sidebar"?: string;
  "data-active"?: string;
  "data-disabled"?: string;
  "data-collapsed"?: string;
}

/**
 * One navigation entry.
 *
 * By default it renders `<li><a href>…</a></li>`. If `href` is omitted and
 * `children` is a React element, that element (typically a router `<Link>`) is
 * rendered as the entry instead. It receives the same layout classes plus
 * `aria-current`, disabled and collapsed data hooks; the consumer still owns
 * its destination and any label hiding it needs for collapsed mode. In the
 * built-in form, collapsing moves the label into `sr-only` so the accessible
 * name survives without extra work.
 */
const SidebarItem = forwardRef<HTMLLIElement, SidebarItemProps>(function SidebarItem(
  {
    href,
    active = false,
    icon,
    disabled = false,
    className,
    children,
    onClick,
    ...props
  },
  ref
) {
  const { collapsed } = useContext(SidebarContext);
  const isCustomAnchor = href === undefined && isValidElement(children);

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    if (disabled) {
      event.preventDefault();
      return;
    }
    onClick?.(event);
  }

  if (isCustomAnchor) {
    const child = children as ReactElement<CustomAnchorProps>;
    const childProps = child.props;
    const injected: Partial<CustomAnchorProps> = {
      "aria-current": active ? "page" : childProps["aria-current"],
      "aria-disabled": disabled ? true : childProps["aria-disabled"],
      tabIndex: disabled ? -1 : childProps.tabIndex,
      "data-km-sidebar": "item-link",
      "data-active": active ? "" : undefined,
      "data-disabled": disabled ? "" : undefined,
      "data-collapsed": collapsed ? "" : undefined,
      className: joinClasses(
        ITEM_CLASSES,
        collapsed && "justify-center px-0",
        active && ACTIVE_ITEM_CLASSES,
        disabled && DISABLED_ITEM_CLASSES,
        className,
        childProps.className
      ),
      onClick: (event: MouseEvent<HTMLAnchorElement>) => {
        if (disabled) {
          event.preventDefault();
          return;
        }
        childProps.onClick?.(event);
        if (!event.defaultPrevented) onClick?.(event);
      },
    };

    return (
      <li
        ref={ref}
        data-km-sidebar="item"
        data-active={active ? "" : undefined}
        data-disabled={disabled ? "" : undefined}
        className="relative min-w-0"
      >
        {cloneElement(child, injected)}
      </li>
    );
  }

  return (
    <li
      ref={ref}
      data-km-sidebar="item"
      data-active={active ? "" : undefined}
      data-disabled={disabled ? "" : undefined}
      className="relative min-w-0"
    >
      <a
        {...props}
        href={disabled ? undefined : href}
        aria-current={active ? "page" : undefined}
        aria-disabled={disabled ? "true" : undefined}
        role={disabled ? "link" : undefined}
        tabIndex={disabled ? -1 : props.tabIndex}
        data-km-sidebar="item-link"
        data-active={active ? "" : undefined}
        data-disabled={disabled ? "" : undefined}
        onClick={handleClick}
        className={joinClasses(
          ITEM_CLASSES,
          collapsed && "justify-center px-0",
          active && ACTIVE_ITEM_CLASSES,
          disabled && DISABLED_ITEM_CLASSES,
          className
        )}
      >
        {icon != null ? (
          <span
            aria-hidden="true"
            data-km-sidebar="icon"
            className="inline-flex size-5 shrink-0 items-center justify-center"
          >
            {icon}
          </span>
        ) : null}
        <span
          data-km-sidebar="label"
          className={collapsed ? "sr-only" : "min-w-0 flex-1 truncate"}
        >
          {children}
        </span>
      </a>
    </li>
  );
});

SidebarItem.displayName = "Sidebar.Item";

export interface SidebarFooterProps extends ComponentPropsWithoutRef<"ul"> {
  /** Extra classes merged onto the footer list. */
  className?: string;
  /**
   * `Sidebar.Item` entries, or your own `<li>`, pinned below the nav. The footer
   * is a list, so entries keep their list-item semantics.
   */
  children?: ReactNode;
}

/**
 * Bottom region pinned below the scrollable nav.
 *
 * Renders a `<ul>` — the same list semantics as `Sidebar.Nav` — because its
 * documented use is holding `Sidebar.Item` entries. Wrap any non-link content
 * (a signed-in label, a status line) in your own `<li>` so the list stays valid.
 */
const SidebarFooter = forwardRef<HTMLUListElement, SidebarFooterProps>(function SidebarFooter(
  { className, children, ...props },
  ref
) {
  const { collapsed } = useContext(SidebarContext);
  return (
    <ul
      {...props}
      ref={ref}
      data-km-sidebar="footer"
      className={joinClasses(
        "flex shrink-0 flex-col gap-2 border-t border-border pt-2",
        collapsed && "items-center",
        className
      )}
    >
      {children}
    </ul>
  );
});

SidebarFooter.displayName = "Sidebar.Footer";

export interface SidebarToggleProps extends ComponentPropsWithoutRef<"button"> {
  /** Accessible name while the rail is expanded. @default "Collapse sidebar" */
  collapseLabel?: string;
  /** Accessible name while the rail is collapsed. @default "Expand sidebar" */
  expandLabel?: string;
  /** Extra classes merged onto the button. */
  className?: string;
}

/**
 * Optional collapse control. The icon is `aria-hidden`; the button's accessible
 * name flips between `collapseLabel` and `expandLabel`, so its action is always
 * announced. Place it in `Sidebar.Header` (or anywhere inside the rail).
 */
const SidebarToggle = forwardRef<HTMLButtonElement, SidebarToggleProps>(function SidebarToggle(
  {
    collapseLabel = "Collapse sidebar",
    expandLabel = "Expand sidebar",
    className,
    onClick,
    type = "button",
    ...props
  },
  ref
) {
  const { collapsed, toggle } = useContext(SidebarContext);

  function handleClick(event: MouseEvent<HTMLButtonElement>) {
    onClick?.(event);
    if (event.defaultPrevented) return;
    toggle();
  }

  return (
    <button
      {...props}
      ref={ref}
      type={type}
      aria-label={collapsed ? expandLabel : collapseLabel}
      data-km-sidebar="toggle"
      data-collapsed={collapsed ? "" : undefined}
      onClick={handleClick}
      className={joinClasses(TOGGLE_CLASSES, className)}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={joinClasses(
          "size-4 transition-transform duration-[var(--km-duration-short)] ease-continuity",
          "motion-reduce:transition-none",
          collapsed && "rotate-180"
        )}
      >
        <path d="M14.5 6.5 9 12l5.5 5.5" />
      </svg>
    </button>
  );
});

SidebarToggle.displayName = "Sidebar.Toggle";

/**
 * `Sidebar` with its parts attached. The parts are also exported by name for
 * consumers that prefer named imports.
 */
const Sidebar = Object.assign(SidebarRoot, {
  Header: SidebarHeader,
  Nav: SidebarNav,
  Item: SidebarItem,
  Group: SidebarGroup,
  Footer: SidebarFooter,
  Toggle: SidebarToggle,
});

export { Sidebar, SidebarHeader, SidebarNav, SidebarItem, SidebarGroup, SidebarFooter, SidebarToggle };
export default Sidebar;
