import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Container } from "@/components/ui/Container";
import { Input } from "@/components/ui/Input";
import { Skeleton } from "@/components/ui/Skeleton";

/**
 * Dev-only component gallery for the design-system primitives in
 * `src/components/ui`. Renders every primitive across its prop matrix so
 * states like loading, error and disabled can be inspected in isolation.
 *
 * Gated behind `NEXT_PUBLIC_ENABLE_UI_GALLERY`; returns 404 when disabled so
 * the route never ships to users.
 */
export const metadata = {
  title: "UI Gallery",
  robots: { index: false, follow: false },
};

type Spec = {
  name: string;
  props: string;
  snippet: string;
  render: () => React.ReactNode;
};

const buttonSpecs: Spec[] = [
  ...(["primary", "secondary", "ghost"] as const).flatMap((variant) =>
    (["sm", "md", "lg"] as const).map((size) => ({
      name: `Button / ${variant} / ${size}`,
      props: `variant="${variant}" size="${size}"`,
      snippet: `<Button variant="${variant}" size="${size}">Button</Button>`,
      render: () => (
        <Button variant={variant} size={size}>
          Button
        </Button>
      ),
    })),
  ),
  {
    name: "Button / block",
    props: "block",
    snippet: `<Button block>Button</Button>`,
    render: () => <Button block>Button</Button>,
  },
  {
    name: "Button / loading",
    props: "loading",
    snippet: `<Button loading>Button</Button>`,
    render: () => <Button loading>Button</Button>,
  },
  {
    name: "Button / disabled",
    props: "disabled",
    snippet: `<Button disabled>Button</Button>`,
    render: () => <Button disabled>Button</Button>,
  },
  {
    name: "Button / anchor",
    props: "href",
    snippet: `<Button href="/">Button</Button>`,
    render: () => <Button href="/">Button</Button>,
  },
];

const badgeSpecs: Spec[] = [
  ...(["neutral", "info", "success", "warning", "danger"] as const).map(
    (tone) => ({
      name: `Badge / ${tone}`,
      props: `tone="${tone}"`,
      snippet: `<Badge tone="${tone}">Badge</Badge>`,
      render: () => <Badge tone={tone}>Badge</Badge>,
    }),
  ),
  {
    name: "Badge / dot",
    props: "dot",
    snippet: `<Badge dot>Badge</Badge>`,
    render: () => <Badge dot>Badge</Badge>,
  },
];

const inputSpecs: Spec[] = [
  {
    name: "Input / default",
    props: "placeholder",
    snippet: `<Input placeholder="Email" />`,
    render: () => <Input placeholder="Email" />,
  },
  {
    name: "Input / disabled",
    props: "disabled",
    snippet: `<Input disabled placeholder="Email" />`,
    render: () => <Input disabled placeholder="Email" />,
  },
  {
    name: "Input / error",
    props: "error",
    snippet: `<Input error="Required" placeholder="Email" />`,
    render: () => <Input error="Required" placeholder="Email" />,
  },
];

const cardSpecs: Spec[] = [
  {
    name: "Card / default",
    props: "—",
    snippet: `<Card>Card</Card>`,
    render: () => <Card>Card</Card>,
  },
];

const skeletonSpecs: Spec[] = [
  {
    name: "Skeleton / default",
    props: "—",
    snippet: `<Skeleton />`,
    render: () => <Skeleton />,
  },
];

const containerSpecs: Spec[] = [
  {
    name: "Container / default",
    props: "—",
    snippet: `<Container>Container</Container>`,
    render: () => <Container>Container</Container>,
  },
];

const groups: { title: string; specs: Spec[] }[] = [
  { title: "Button", specs: buttonSpecs },
  { title: "Badge", specs: badgeSpecs },
  { title: "Input", specs: inputSpecs },
  { title: "Card", specs: cardSpecs },
  { title: "Skeleton", specs: skeletonSpecs },
  { title: "Container", specs: containerSpecs },
];

function Swatch({ spec }: { spec: Spec }) {
  return (
    <Card>
      <p className="text-sm font-medium">{spec.name}</p>
      <p className="text-xs text-muted-foreground">{spec.props}</p>
      <div className="mt-3">{spec.render()}</div>
      <pre className="mt-3 overflow-x-auto rounded bg-muted p-2 text-xs">
        <code>{spec.snippet}</code>
      </pre>
    </Card>
  );
}

export default function UiGalleryPage() {
  if (process.env.NEXT_PUBLIC_ENABLE_UI_GALLERY !== "true") {
    notFound();
  }

  return (
    <Container className="space-y-10 py-10">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">UI Gallery</h1>
        <p className="text-sm text-muted-foreground">
          Dev-only gallery of the design-system primitives. Toggle the theme and
          resize the viewport to verify every state.
        </p>
      </header>

      {groups.map((group) => (
        <section key={group.title} className="space-y-4">
          <h2 className="text-lg font-medium">{group.title}</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {group.specs.map((spec) => (
              <Swatch key={spec.name} spec={spec} />
            ))}
          </div>
        </section>
      ))}

      <section className="space-y-2">
        <h2 className="text-lg font-medium">Reduced motion</h2>
        <p className="text-sm text-muted-foreground">
          Motion demos render the static variant when the user has opted out of
          motion; no animation is forced.
        </p>
      </section>
    </Container>
  );
}
