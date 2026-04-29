export default function Home() {
  return (
    <main className="min-h-screen w-full flex flex-col gap-[16px] min-h-[844px] w-full max-w-[390px] p-[16px] bg-[#f7fafc]">
      <p data-ir-id="home-greeting" data-ir-name="Greeting" className="w-full max-w-[358px] h-[32px] text-[24px] text-[#1c1f24] leading-[32px] font-[700] whitespace-pre-wrap">{"Good Morning"}</p>
      <p data-ir-id="home-subtitle" data-ir-name="Subtitle" className="w-full max-w-[358px] h-[20px] text-[14px] text-[#666b75] leading-[20px] font-[400] whitespace-pre-wrap">{"Here is your daily summary"}</p>
    </main>
  );
}
