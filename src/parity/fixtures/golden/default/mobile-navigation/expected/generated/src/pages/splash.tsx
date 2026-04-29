export default function Splash() {
  return (
    <main className="min-h-screen w-full flex flex-col gap-[16px] min-h-[844px] w-full max-w-[390px] px-[24px] py-[200px] bg-[#265cf5]">
      <h1 data-ir-id="splash-title" data-ir-name="Title" className="w-[342px] h-[48px] text-[40px] text-[#ffffff] leading-[48px] font-[800] text-center whitespace-pre-wrap">{"AppName"}</h1>
      <p data-ir-id="splash-tagline" data-ir-name="Tagline" className="w-[342px] h-[24px] text-[16px] text-[#d9e6ff] leading-[24px] font-[400] text-center whitespace-pre-wrap">{"Your digital companion"}</p>
    </main>
  );
}
