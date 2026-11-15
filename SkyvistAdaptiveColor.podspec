require 'json'
package = JSON.parse(File.read(File.join(__dir__, 'package.json')))
Pod::Spec.new do |s|
  s.name = 'SkyvistAdaptiveColor'
  s.version = package['version']
  s.summary = package['description']
  s.homepage = package['homepage']
  s.license = { :type => 'MIT', :file => 'LICENSE' }
  s.author = package['author']
  s.source = { :git => "https://github.com/milosdelibasic/adaptive-color.git", :tag => "v#{s.version}" }
  s.platforms = { :ios => min_ios_version_supported }
  s.frameworks = ['AVFoundation', 'CoreVideo', 'CoreGraphics', 'QuartzCore', 'UIKit']
  s.source_files = 'ios/**/*.{h,m,mm}'
  install_modules_dependencies(s)
end
