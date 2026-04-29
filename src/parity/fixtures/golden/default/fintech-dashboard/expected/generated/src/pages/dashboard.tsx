export default function Dashboard() {
  return (
    <main className="min-h-screen w-full flex flex-col gap-[24px] min-h-[900px] w-full max-w-[1200px] p-[24px] bg-[#f5f7fa]">
      <h1 data-ir-id="dash-title" data-ir-name="Title" className="w-[300px] h-[36px] text-[28px] text-[#1c1f24] leading-[36px] font-[700] whitespace-pre-wrap">{"Dashboard Overview"}</h1>
      <table data-ir-id="cards-grid" data-ir-name="Cards Grid" className="grid grid-cols-3 gap-[16px] min-h-[600px] w-full max-w-[1152px]">
        <article data-ir-id="card-revenue" data-ir-name="Revenue Card" className="relative min-h-[200px] w-[360px] bg-[#ffffff] rounded-[12px]">
          <h1 data-ir-id="rev-label" data-ir-name="Card Title" className="absolute left-[16px] top-[16px] w-[80px] h-[20px] text-[14px] text-[#666b75] leading-[20px] font-[500] whitespace-pre-wrap">{"Revenue"}</h1>
          <h1 data-ir-id="rev-value" data-ir-name="Value" className="absolute left-[16px] top-[44px] w-[200px] h-[40px] text-[32px] text-[#1c1f24] leading-[40px] font-[700] whitespace-pre-wrap">{"$45,231"}</h1>
        </article>
        <article data-ir-id="card-chart" data-ir-name="Chart Card" className="relative min-h-[280px] w-[736px] bg-[#ffffff] rounded-[12px]">
          <h1 data-ir-id="chart-title" data-ir-name="Card Title" className="absolute left-[16px] top-[16px] w-[200px] h-[28px] text-[18px] text-[#1c1f24] leading-[28px] font-[600] whitespace-pre-wrap">{"Sales Overview"}</h1>
          <p data-ir-id="chart-subtitle" data-ir-name="Subtitle" className="absolute left-[16px] top-[48px] w-[250px] h-[20px] text-[14px] text-[#666b75] leading-[20px] font-[400] whitespace-pre-wrap">{"Monthly revenue trends"}</p>
        </article>
        <article data-ir-id="card-users" data-ir-name="Users Card" className="relative min-h-[200px] w-[360px] bg-[#ffffff] rounded-[12px]">
          <h1 data-ir-id="users-label" data-ir-name="Card Title" className="absolute left-[16px] top-[16px] w-[100px] h-[20px] text-[14px] text-[#666b75] leading-[20px] font-[500] whitespace-pre-wrap">{"Active Users"}</h1>
          <h1 data-ir-id="users-value" data-ir-name="Value" className="absolute left-[16px] top-[44px] w-[150px] h-[40px] text-[32px] text-[#1c1f24] leading-[40px] font-[700] whitespace-pre-wrap">{"2,350"}</h1>
        </article>
        <article data-ir-id="card-orders" data-ir-name="Orders Card" className="relative min-h-[200px] w-[400px] bg-[#ffffff] rounded-[12px]">
          <h1 data-ir-id="orders-label" data-ir-name="Card Title" className="absolute left-[16px] top-[16px] w-[120px] h-[20px] text-[14px] text-[#666b75] leading-[20px] font-[500] whitespace-pre-wrap">{"Pending Orders"}</h1>
          <h1 data-ir-id="orders-value" data-ir-name="Value" className="absolute left-[16px] top-[44px] w-[100px] h-[40px] text-[32px] text-[#1c1f24] leading-[40px] font-[700] whitespace-pre-wrap">{"127"}</h1>
        </article>
        <article data-ir-id="card-activity" data-ir-name="Activity Card" className="relative min-h-[280px] w-[400px] bg-[#ffffff] rounded-[12px]">
          <h1 data-ir-id="activity-title" data-ir-name="Card Title" className="absolute left-[16px] top-[16px] w-[200px] h-[28px] text-[18px] text-[#1c1f24] leading-[28px] font-[600] whitespace-pre-wrap">{"Recent Activity"}</h1>
          <p data-ir-id="activity-subtitle" data-ir-name="Subtitle" className="absolute left-[16px] top-[48px] w-[150px] h-[20px] text-[14px] text-[#666b75] leading-[20px] font-[400] whitespace-pre-wrap">{"Last 7 days"}</p>
        </article>
      </table>
    </main>
  );
}
