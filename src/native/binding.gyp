{
  "targets": [
    {
      "target_name": "window_invisibility",
      "sources": [ "window_invisibility.cc" ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")"
      ],
      "dependencies": [
        "<!(node -p \"require('node-addon-api').gyp\")"
      ],
      "cflags!": [ "-fno-exceptions" ],
      "cflags_cc!": [ "-fno-exceptions" ],
      "conditions": [
        ["OS==\"win\"", {
          "libraries": [ "-luser32.lib" ],
          "msvs_settings": {
            "VCCLCompilerTool": { "ExceptionHandling": 1 }
          }
        }],
        ["OS==\"mac\"", {
          "xcode_settings": {
            "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
            "CLANG_CXX_LIBRARY": "libc++",
            "MACOSX_DEPLOYMENT_TARGET": "10.15",
            "OTHER_CPLUSPLUSFLAGS": [
              "-std=c++17",
              "-stdlib=libc++"
            ]
          },
          "link_settings": {
            "libraries": [
              "-framework AppKit",
              "-framework Cocoa"
            ]
          }
        }]
      ]
    }
  ]
}

