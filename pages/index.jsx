import dynamic from "next/dynamic";

const FPADashboard = dynamic(() => import("../FPADashboard"), {
  ssr: false,
  loading: () => (
    <div style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      minHeight: "100vh",
      background: "#080B12",
      color: "#6B7280",
      fontFamily: "Outfit, sans-serif",
      fontSize: "14px",
    }}>
      Loading FinanceOS...
    </div>
  ),
});

export default function Home() {
  return <FPADashboard />;
}
