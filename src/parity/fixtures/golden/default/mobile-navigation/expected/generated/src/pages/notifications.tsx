export default function Notifications() {
  return (
    <main className="min-h-screen w-full flex flex-col gap-[8px] min-h-[844px] w-full max-w-[390px] p-[16px] bg-[#ffffff]">
      <h1 data-ir-id="notif-title" data-ir-name="Title" className="w-full max-w-[358px] h-[32px] text-[24px] text-[#1c1f24] leading-[32px] font-[700] whitespace-pre-wrap">{"Notifications"}</h1>
      <p data-ir-id="notif-empty" data-ir-name="Empty State" className="w-full max-w-[358px] h-[20px] text-[14px] text-[#999ea8] leading-[20px] font-[400] text-center whitespace-pre-wrap">{"No new risk alerts"}</p>
    </main>
  );
}
