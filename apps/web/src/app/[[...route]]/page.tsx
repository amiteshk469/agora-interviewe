import { RoundCraft } from "@/components/roundcraft";
import { routeKey } from "@/lib/utils";

type PageProps = { params: Promise<{ route?: string[] }> };

export default async function Page({ params }: PageProps) {
  const { route } = await params;
  return <RoundCraft screen={routeKey(route)} />;
}
