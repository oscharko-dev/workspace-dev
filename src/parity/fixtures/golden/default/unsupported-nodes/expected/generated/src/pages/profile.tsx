import StatusChipBadge from "../components/StatusChipBadge";
import StatusChipBadge2 from "../components/StatusChipBadge2";

export default function Profile() {
  return (
    <main className="min-h-screen w-full flex flex-col gap-[16px] min-h-[1000px] w-full max-w-[800px] p-[24px] bg-[#f7f7fa]">
      <h1 data-ir-id="profile-title" data-ir-name="Title" className="w-[200px] h-[32px] text-[24px] text-[#212121] leading-[32px] font-[700] whitespace-pre-wrap">{"Access Review"}</h1>
      <section data-ir-id="avatar-section" data-ir-name="Avatar Section" className="flex flex-row items-center gap-[16px] min-h-[80px] w-full max-w-[752px]">
        <div data-ir-id="avatar" data-ir-name="Avatar" className="w-[64px] h-[64px] bg-[#617df5]" />
        <section data-ir-id="avatar-info" data-ir-name="Info" className="flex flex-col gap-[4px] min-h-[64px] w-[400px]">
          <p data-ir-id="user-name" data-ir-name="Name" className="w-[200px] h-[28px] text-[20px] text-[#212121] leading-[28px] font-[600] whitespace-pre-wrap">{"Demo Reviewer"}</p>
          <p data-ir-id="user-role" data-ir-name="Role" className="w-[200px] h-[20px] text-[14px] text-[#757575] leading-[20px] font-[400] whitespace-pre-wrap">{"Risk Operations"}</p>
        </section>
      </section>
      <article data-ir-id="stats-card-1" data-ir-name="Stats Card" className="flex flex-col gap-[8px] min-h-[120px] w-[240px] bg-[#ffffff] rounded-[12px]">
        <p data-ir-id="stat1-label" data-ir-name="Label" className="w-[80px] h-[20px] text-[14px] text-[#757575] leading-[20px] font-[500] whitespace-pre-wrap">{"Queues"}</p>
        <h1 data-ir-id="stat1-value" data-ir-name="Value" className="w-[60px] h-[44px] text-[36px] text-[#212121] leading-[44px] font-[700] whitespace-pre-wrap">{"42"}</h1>
      </article>
      <article data-ir-id="stats-card-2" data-ir-name="Stats Card" className="flex flex-col gap-[8px] min-h-[120px] w-[240px] bg-[#ffffff] rounded-[12px]">
        <p data-ir-id="stat2-label" data-ir-name="Label" className="w-[120px] h-[20px] text-[14px] text-[#757575] leading-[20px] font-[500] whitespace-pre-wrap">{"Checks"}</p>
        <h1 data-ir-id="stat2-value" data-ir-name="Value" className="w-[100px] h-[44px] text-[36px] text-[#212121] leading-[44px] font-[700] whitespace-pre-wrap">{"1,284"}</h1>
      </article>
      <article data-ir-id="stats-card-3" data-ir-name="Stats Card" className="flex flex-col gap-[8px] min-h-[120px] w-[240px] bg-[#ffffff] rounded-[12px]">
        <p data-ir-id="stat3-label" data-ir-name="Label" className="w-[80px] h-[20px] text-[14px] text-[#757575] leading-[20px] font-[500] whitespace-pre-wrap">{"Approvals"}</p>
        <h1 data-ir-id="stat3-value" data-ir-name="Value" className="w-[50px] h-[44px] text-[36px] text-[#212121] leading-[44px] font-[700] whitespace-pre-wrap">{"89"}</h1>
      </article>
      <hr data-ir-id="divider-1" data-ir-name="Divider" className="w-full max-w-[752px] h-[1px] border border-[#e0e0e0]" />
      <section data-ir-id="chip-section" data-ir-name="Skills" className="flex flex-row items-center gap-[8px] min-h-[40px] w-full max-w-[752px]">
        <StatusChipBadge2 label={"Payments"} irId={"chip-1"} irName={"Status Chip"} labelIrId={"chip-1-label"} labelIrName={"Label"} />
        <StatusChipBadge label={"Limits"} irId={"chip-2"} irName={"Status Chip"} labelIrId={"chip-2-label"} labelIrName={"Label"} />
        <StatusChipBadge2 label={"Cards"} irId={"chip-3"} irName={"Status Chip"} labelIrId={"chip-3-label"} labelIrName={"Label"} />
        <StatusChipBadge label={"Audit"} irId={"chip-4"} irName={"Status Chip"} labelIrId={"chip-4-label"} labelIrName={"Label"} />
      </section>
      <span data-ir-id="badge-item" data-ir-name="Notification Badge" className="relative min-h-[48px] w-[48px]">
        <div data-ir-id="badge-icon" data-ir-name="Icon" className="absolute w-[40px] h-[40px] bg-[#d9d9d9]" />
        <span data-ir-id="badge-count" data-ir-name="Badge" className="absolute left-[28px] min-h-[20px] w-[20px] bg-[#f54236]">
          <p data-ir-id="badge-text" data-ir-name="Count" className="absolute left-[6px] top-[2px] w-[8px] h-[16px] text-[12px] text-[#ffffff] leading-[16px] font-[600] text-center whitespace-pre-wrap">{"3"}</p>
        </span>
      </span>
    </main>
  );
}
