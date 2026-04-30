export default function About() {
  return (
    <main className="min-h-screen w-full flex flex-col gap-[16px] min-h-[844px] w-full max-w-[390px] p-[24px] bg-[#ffffff]">
      <h1 data-ir-id="about-title" data-ir-name="Title" className="w-[342px] h-[32px] text-[24px] text-[#1c1f24] leading-[32px] font-[700] whitespace-pre-wrap">{"About"}</h1>
      <p data-ir-id="about-version" data-ir-name="Version" className="w-[342px] h-[20px] text-[14px] text-[#666b75] leading-[20px] font-[400] whitespace-pre-wrap">{"Version 2.1.0"}</p>
      <p data-ir-id="about-body" data-ir-name="Body" className="w-[342px] h-[24px] text-[16px] text-[#1c1f24] leading-[24px] font-[400] whitespace-pre-wrap">{"OSS-neutral mobile banking demo."}</p>
    </main>
  );
}
