// 썸네일 글자 읽기 (맥 기본 문자 인식 Vision). 줄마다 "아래끝 높이 글자" — 위치는 0~1 비율
// 사용: swiftc -O scripts/ocr.swift -o /tmp/ocr && /tmp/ocr 그림.jpg [raw]
// raw = 맞춤법 교정 끄기 (교정이 성경 구절의 '-'를 지워 버려서, 구절은 raw로 읽는다)
import Vision
import AppKit
let url = URL(fileURLWithPath: CommandLine.arguments[1])
let img = NSImage(contentsOf: url)!
var rect = CGRect(origin: .zero, size: img.size)
let cg = img.cgImage(forProposedRect: &rect, context: nil, hints: nil)!
let req = VNRecognizeTextRequest()
req.recognitionLevel = .accurate
req.recognitionLanguages = ["ko-KR"]
req.usesLanguageCorrection = CommandLine.arguments.count < 3
try VNImageRequestHandler(cgImage: cg).perform([req])
for o in req.results ?? [] {
  let b = o.boundingBox
  print(String(format: "%.3f %.3f", b.minY, b.height), o.topCandidates(1)[0].string)
}
