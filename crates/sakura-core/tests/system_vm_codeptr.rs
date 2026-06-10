use sakura_core::{Result, SystemCallFamily, SystemValue, SystemVm, SystemVmEvent};

#[test]
fn invalid_code_pointer_does_not_abort_vm_execution() -> Result<()> {
    let mut script = vec![0u8; 0x10];
    script.push(0x05);
    script.extend_from_slice(&(-0x20i16).to_le_bytes());
    script.extend_from_slice(&[0x91, 0x88, 0x17]);
    let mut vm = SystemVm::parse(&script)?;

    assert_eq!(
        vm.next_event()?,
        SystemVmEvent::ServiceCall {
            family: SystemCallFamily::Graph,
            service_id: 0x88,
            args: vec![SystemValue::Unknown],
        }
    );
    Ok(())
}
