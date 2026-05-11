export default function Profile() {
  return (
    <main className="min-h-screen w-full flex flex-col gap-[16px] min-h-[844px] w-full max-w-[390px] p-[24px] bg-[#ffffff]">
      <h1 data-ir-id="prof-title" data-ir-name="Title" className="w-[342px] h-[32px] text-[24px] text-[#1c1f24] leading-[32px] font-[700] whitespace-pre-wrap">{"My Profile"}</h1>
      <div data-ir-id="prof-avatar" data-ir-name="Avatar" className="w-[80px] h-[80px] bg-[#d9d9e6]" />
    </main>
  );
}
