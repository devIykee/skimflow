import ActivityFeed from "./_components/ActivityFeed";
import RevenueCharts from "./_components/RevenueCharts";
import HealthPanel from "./_components/HealthPanel";
import RelayerCard from "./_components/RelayerCard";

export const dynamic = "force-dynamic";

export default function AdminHome() {
  return (
    <div className="flex flex-col gap-6">
      <RelayerCard />
      <ActivityFeed />
      <RevenueCharts />
      <HealthPanel />
    </div>
  );
}
