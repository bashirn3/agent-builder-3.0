import AppKit
import Foundation

struct FlowSpec {
    let dir: String
    let title: String
    let ids: [String]
}

let root = URL(fileURLWithPath: CommandLine.arguments.count > 1
    ? CommandLine.arguments[1]
    : FileManager.default.currentDirectoryPath)

let flows: [FlowSpec] = [
    FlowSpec(dir: "playground/setting-up-a-playground", title: "Setting up a playground", ids: [
        "b8a8262b-bd97-48ef-9062-8bdbe0775b1b",
        "d1700c28-1cd6-4b67-a9ff-3499feabb9c5",
        "684403d5-e539-49c5-b554-e28d382734cc",
        "f68fb0a4-3309-4cc3-b904-dc9cb724943a",
        "0f247934-8493-4cfd-bf62-c8456895ac60",
        "9543d80a-ccd3-424b-ad70-4fa089d6ab99",
        "ad5b033b-28a2-49c7-86bf-79db406649a0",
        "c1aaa276-ad9c-4c64-8dab-b5d546186d28",
        "164c77bd-f9dc-4f57-b511-cc7107cdc070",
        "6ae9a069-07ff-4407-9148-384cd2e3ee8a",
        "d684d184-9acb-46cd-ac39-8d33c4dd724c",
        "a8885312-d9cb-4e12-8a4e-c92dc9ac9bd0",
        "d32557c2-eb20-4a80-b63b-ce70d134879f",
        "9ae2b438-a596-430c-8130-40d3e9f3abf6",
        "cb6931d8-f2ee-4618-a75e-db03cae94459",
    ]),
    FlowSpec(dir: "playground/setting-up-an-agent", title: "Setting up an agent", ids: [
        "78548a27-8ee6-48cc-92cb-886a5824d6fb",
        "1a90d4fb-5a39-44bd-bea2-699a6c9c3efa",
        "45ff559f-e281-4657-9646-e4ce4c86e5b6",
        "e2dc63aa-3369-4afd-ba10-82a502114afa",
        "5ac07838-b2fc-4025-afb6-45c0012ab7a1",
        "21e14714-f1e3-42ef-bc75-fec771a0e208",
        "36bae7e5-535b-453d-b9df-b2bed6c7f07b",
    ]),
    FlowSpec(dir: "playground/comparing-ai-models", title: "Comparing AI models", ids: [
        "6ae9a069-07ff-4407-9148-384cd2e3ee8a",
        "78548a27-8ee6-48cc-92cb-886a5824d6fb",
        "218e17de-51f8-4ba2-94e8-8c790c9e5162",
        "fa79d27e-f521-4410-a6a0-87aa921b6319",
    ]),
    FlowSpec(dir: "playground/recording-a-prompt", title: "Recording a prompt", ids: [
        "78548a27-8ee6-48cc-92cb-886a5824d6fb",
        "b47a6118-b106-42ee-9e7e-7d52dfa28658",
        "218e17de-51f8-4ba2-94e8-8c790c9e5162",
    ]),
    FlowSpec(dir: "playground/adding-an-instance", title: "Adding an instance", ids: [
        "5ac07838-b2fc-4025-afb6-45c0012ab7a1",
        "d04586a4-5e3b-472e-b63b-069e15c7ee7d",
    ]),
    FlowSpec(dir: "playground/moving-instances", title: "Moving instances", ids: [
        "5ac07838-b2fc-4025-afb6-45c0012ab7a1",
        "4161d47e-955b-4f4c-8567-01e99313c58a",
        "e609d3e9-f6ae-41e3-b882-27005168625c",
    ]),
    FlowSpec(dir: "playground/deleting-an-instance", title: "Deleting an instance", ids: [
        "4161d47e-955b-4f4c-8567-01e99313c58a",
        "f7b551e2-9cfb-45f6-821e-183585a02045",
    ]),
    FlowSpec(dir: "auth/logging-in", title: "Logging in", ids: [
        "cf69146f-f96f-41ce-ac78-dba5aac058f0",
        "b276a198-6887-48d5-a4a4-2722d786e565",
        "c2589960-5c7b-48b0-a9e5-3f27e2825726",
        "8f094db2-17ba-4639-8c66-a28e8d1c98f6",
        "e370cba8-007b-4a51-8896-900086b67f3e",
        "0a2ac074-eb51-4253-9071-3f8101ab8ed9",
        "21e8aa9d-c0f5-478a-a615-25471e1047db",
        "46f67829-63fe-4bbc-95de-8d3258812837",
    ]),
    FlowSpec(dir: "auth/logging-out", title: "Logging out", ids: [
        "c0638095-87a3-4588-bbea-f8f4c1563af1",
        "cf69146f-f96f-41ce-ac78-dba5aac058f0",
    ]),
    FlowSpec(dir: "auth/reset-password", title: "Reset password", ids: [
        "e370cba8-007b-4a51-8896-900086b67f3e",
        "3d0e09b6-2b38-4c58-bf84-94ac2344d893",
        "3089bf13-aab7-40d8-adf7-b7d9dc8340b4",
        "b088b603-11b4-4cd4-8e53-30cf08399785",
        "2123633d-0401-47cc-a67a-22743da0241a",
        "e23ddfb0-32f8-4ed3-830c-127bbd8dc7b3",
        "e1163660-4fe6-49fd-9058-97c2a054a705",
    ]),
    FlowSpec(dir: "auth/setting-up-two-factor-authentication", title: "Setting up two-factor authentication", ids: [
        "22d98409-6111-44bc-af05-8df237cab0a8",
        "dbbdd1d7-207a-465c-998a-29a609b24a9c",
        "50896e7e-1c87-4ea8-b2cb-cdd6e92c53d4",
        "52635aa2-273b-4255-bf2c-7a8614b06430",
        "0ab936a1-6fe8-4fe4-979f-aff8b1b2f61c",
    ]),
    FlowSpec(dir: "auth/onboarding", title: "Onboarding", ids: [
        "3cfeb1b0-d89a-4b34-8bc8-e677792ba8b6",
        "1950c842-8de9-4c4e-a45d-ceaffc41d023",
        "45e21367-0b01-4472-ae48-b50aca136d08",
        "6f5ef2d1-fc3f-4be4-9e1b-2a492837eb01",
        "d64d6346-11da-43fb-a102-4716c8fb17d6",
        "1e455515-a3bf-47cb-be1c-765175e83091",
        "6f6ce167-aec5-4260-bc37-bcd2414c04b5",
        "0b886108-f3f4-4b9d-98ad-9897a23448a4",
        "a72f46fc-e9bf-4f8a-b7dd-bb34b8db4ea2",
        "4f106772-fa21-4410-a117-7a14910db626",
        "e6b6c766-ad61-48b3-aedd-f9a6b40bcb40",
        "fd22051b-6ddd-4b5c-879b-759d2b33bba6",
        "b26cf72b-8063-4551-9d56-3884cc8be773",
        "da168eb7-4bed-404e-8bb4-11826391141e",
        "9afd6b0c-2759-44fd-9306-c66ec3489ce7",
        "6c22e0e3-47b0-4910-aaf9-b31364015f84",
        "ceea88d9-0c49-4f75-a5e3-75d397e0a375",
        "c9f4e75a-8f24-4fad-9cb0-f473e581b65c",
        "8a74b51d-ea06-476e-b511-6c8a12544cb6",
        "b8a8262b-bd97-48ef-9062-8bdbe0775b1b",
    ]),
]

let thumbW: CGFloat = 520
let thumbH: CGFloat = 357.5
let cols = 3
let perSheet = 6
let pad: CGFloat = 28
let gap: CGFloat = 18
let labelH: CGFloat = 36
let titleH: CGFloat = 44
let footerH: CGFloat = 28

func loadImage(_ url: URL) -> NSImage? {
    guard let img = NSImage(contentsOf: url) else { return nil }
    return img
}

func draw(_ string: String, in rect: NSRect, size: CGFloat, weight: NSFont.Weight, color: NSColor) {
    let font = NSFont.systemFont(ofSize: size, weight: weight)
    let attrs: [NSAttributedString.Key: Any] = [
        .font: font,
        .foregroundColor: color,
    ]
    let ns = NSAttributedString(string: string, attributes: attrs)
    ns.draw(with: rect, options: [.usesLineFragmentOrigin, .truncatesLastVisibleLine])
}

func makeSheet(flow: FlowSpec, sheetIndex: Int, items: [(Int, String, NSImage)]) {
    let rows = Int(ceil(Double(items.count) / Double(cols)))
    let width = pad * 2 + CGFloat(cols) * thumbW + CGFloat(cols - 1) * gap
    let height = pad + titleH + CGFloat(rows) * (thumbH + labelH + gap) + footerH

    let image = NSImage(size: NSSize(width: width, height: height))
    image.lockFocus()
    NSColor(calibratedWhite: 0.96, alpha: 1).setFill()
    NSBezierPath(rect: NSRect(x: 0, y: 0, width: width, height: height)).fill()

    let title = "\(flow.title)  ·  sheet \(String(format: "%02d", sheetIndex))  ·  frames \(items.first!.0)–\(items.last!.0) of \(flow.ids.count)"
    draw(title, in: NSRect(x: pad, y: height - pad - 28, width: width - pad * 2, height: 28), size: 16, weight: .semibold, color: .black)
    draw("1920×1320 originals scaled for review. Mobbin footer chrome is part of each capture.",
         in: NSRect(x: pad, y: 8, width: width - pad * 2, height: 16), size: 11, weight: .regular, color: NSColor(calibratedWhite: 0.35, alpha: 1))

    for (i, item) in items.enumerated() {
        let col = i % cols
        let row = i / cols
        let x = pad + CGFloat(col) * (thumbW + gap)
        let y = height - pad - titleH - CGFloat(row + 1) * (thumbH + labelH + gap) + gap
        let thumbRect = NSRect(x: x, y: y + labelH, width: thumbW, height: thumbH)
        NSColor.white.setFill()
        NSBezierPath(rect: thumbRect).fill()
        item.2.draw(in: thumbRect, from: .zero, operation: .copy, fraction: 1)
        NSColor(calibratedWhite: 0.78, alpha: 1).setStroke()
        let border = NSBezierPath(rect: thumbRect.insetBy(dx: 0.5, dy: 0.5))
        border.lineWidth = 1
        border.stroke()
        let shortId = String(item.1.prefix(8))
        draw(String(format: "%02d  %@", item.0, shortId),
             in: NSRect(x: x, y: y + 8, width: thumbW, height: 20),
             size: 12, weight: .medium, color: .black)
    }

    image.unlockFocus()

    let dest = root.appendingPathComponent(flow.dir).appendingPathComponent(String(format: "contact-sheet-%02d.png", sheetIndex))
    guard let tiff = image.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff),
          let png = rep.representation(using: .png, properties: [:]) else {
        fputs("Failed to write \(dest.path)\n", stderr)
        return
    }
    try! png.write(to: dest)
    print("wrote \(dest.path)")
}

for flow in flows {
    var images: [(Int, String, NSImage)] = []
    for (idx, id) in flow.ids.enumerated() {
        let n = idx + 1
        let url = root.appendingPathComponent(flow.dir).appendingPathComponent("images").appendingPathComponent(String(format: "%02d.png", n))
        guard let img = loadImage(url) else {
            fputs("Missing \(url.path)\n", stderr)
            continue
        }
        images.append((n, id, img))
    }
    let sheets = stride(from: 0, to: images.count, by: perSheet).map { Array(images[$0..<min($0 + perSheet, images.count)]) }
    for (i, sheet) in sheets.enumerated() {
        makeSheet(flow: flow, sheetIndex: i + 1, items: sheet)
    }
}
