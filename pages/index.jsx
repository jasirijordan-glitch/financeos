import dynamic from "next/dynamic";
const FPADashboard = dynamic(() => import("../components/FPADashboard"), { ssr: false });
export default function Home() { return <FPADashboard />; }