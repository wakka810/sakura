use crate::system_vm::SystemValue;

pub(crate) const CODE_ADDRESS_BASE: u32 = 0x1000_0000;
pub(crate) const CODE_ADDRESS_ALT_BASE: u32 = 0x1100_0000;
pub(crate) const LOCAL_ADDRESS_BASE: u32 = 0x1200_0000;
pub(crate) const LOCAL_ADDRESS_ALT_BASE: u32 = 0x1300_0000;
pub(crate) const ADDRESS_OFFSET_MASK: u32 = 0x01ff_ffff;

pub(crate) fn apply_basic_no_operand<'a>(opcode: u8, stack: &mut Vec<SystemValue<'a>>) -> bool {
    let result = match opcode {
        0x28 | 0x3a | 0x48 | 0x49 => {
            let value = stack.pop();
            value
                .as_ref()
                .and_then(|value| eval_unary_integer(opcode, value))
                .map_or(SystemValue::Unknown, SystemValue::Integer)
        }
        0x43 | 0x44 => {
            let right = stack.pop();
            let left = stack.pop();
            eval_fixed_binary(opcode, left.as_ref(), right.as_ref()).unwrap_or(SystemValue::Unknown)
        }
        0x40 => {
            let false_value = stack.pop().unwrap_or(SystemValue::Unknown);
            let true_value = stack.pop().unwrap_or(SystemValue::Unknown);
            let compare = stack.pop();
            eval_ternary(compare.as_ref(), true_value, false_value).unwrap_or(SystemValue::Unknown)
        }
        0x42 => {
            let divisor = stack.pop();
            let multiplier = stack.pop();
            let multiplicand = stack.pop();
            eval_muldiv(multiplicand.as_ref(), multiplier.as_ref(), divisor.as_ref())
                .map_or(SystemValue::Unknown, SystemValue::Integer)
        }
        0x68 => {
            let value = stack.pop();
            string_bytes(value.as_ref())
                .map(|bytes| bytes.len() as u64)
                .map_or(SystemValue::Unknown, SystemValue::Integer)
        }
        0x69 => {
            let right = stack.pop();
            let left = stack.pop();
            match (string_bytes(left.as_ref()), string_bytes(right.as_ref())) {
                (Some(left), Some(right)) => SystemValue::Integer(u64::from(left == right)),
                _ => SystemValue::Unknown,
            }
        }
        0x70 => {
            stack.pop();
            SystemValue::Unknown
        }
        _ => return false,
    };
    stack.push(result);
    true
}

pub(crate) fn eval_basic_binary_integer(opcode: u8, left: u64, right: u64) -> Option<u64> {
    Some(match opcode {
        0x20 => left.wrapping_add(right),
        0x21 => left.wrapping_sub(right),
        0x22 => left.wrapping_mul(right),
        0x23 => signed_div32(left, right),
        0x24 => signed_rem32(left, right),
        0x25 => left & right,
        0x26 => left | right,
        0x27 => left ^ right,
        0x29 => left.wrapping_shl((right & 0x1f) as u32),
        0x2a => left.wrapping_shr((right & 0x1f) as u32),
        0x2b => u64::from(((left as i32) >> (right & 0x1f)) as u32),
        0x30 => u64::from(left == right),
        0x31 => u64::from(left != right),
        0x32 => u64::from((left as i32) <= (right as i32)),
        0x33 => u64::from((left as i32) >= (right as i32)),
        0x34 => u64::from((left as i32) < (right as i32)),
        0x35 => u64::from((left as i32) > (right as i32)),
        0x38 => u64::from(left != 0 && right != 0),
        0x39 => u64::from(left != 0 || right != 0),
        _ => return None,
    })
}

pub(crate) fn eval_extended_binary_integer(opcode: u8, left: u64, right: u64) -> Option<u64> {
    Some(match opcode {
        0x43 => fixed_arctan(left, right),
        0x44 => fixed_veclen(left, right),
        _ => return None,
    })
}

pub(crate) fn system_value_integer(value: &SystemValue<'_>) -> Option<u64> {
    match value {
        SystemValue::Integer(value) => Some(*value),
        SystemValue::Code(offset) => Some(u64::from(CODE_ADDRESS_BASE | (*offset as u32))),
        SystemValue::CodeInScript { offset, .. } => {
            Some(u64::from(CODE_ADDRESS_BASE | (*offset as u32)))
        }
        SystemValue::VariablePointer(address) => Some(u64::from(
            LOCAL_ADDRESS_BASE | (*address & ADDRESS_OFFSET_MASK),
        )),
        SystemValue::UserScriptHandle(handle) => Some(u64::from(*handle)),
        SystemValue::UserScriptResult(_) => Some(0),
        SystemValue::LocalStringPointer { address, .. } => Some(u64::from(
            LOCAL_ADDRESS_BASE | (*address & ADDRESS_OFFSET_MASK),
        )),
        SystemValue::String(_) | SystemValue::OwnedString(_) | SystemValue::Unknown => None,
    }
}

fn eval_fixed_binary<'a>(
    opcode: u8,
    left: Option<&SystemValue<'a>>,
    right: Option<&SystemValue<'a>>,
) -> Option<SystemValue<'a>> {
    eval_extended_binary_integer(
        opcode,
        system_value_integer(left?)?,
        system_value_integer(right?)?,
    )
    .map(SystemValue::Integer)
}

pub(crate) fn signed_div32(left: u64, right: u64) -> u64 {
    let right = right as i32;
    if right == 0 {
        u64::MAX
    } else {
        u64::from(((left as i32) / right) as u32)
    }
}

pub(crate) fn signed_rem32(left: u64, right: u64) -> u64 {
    let right = right as i32;
    if right == 0 {
        u64::MAX
    } else {
        u64::from(((left as i32) % right) as u32)
    }
}

fn eval_unary_integer(opcode: u8, value: &SystemValue<'_>) -> Option<u64> {
    let value = system_value_integer(value)?;
    match opcode {
        0x28 => Some(u64::from(!(value as u32))),
        0x3a => Some(u64::from(value == 0)),
        0x48 => Some(fixed_trig(value, f64::sin)),
        0x49 => Some(fixed_trig(value, f64::cos)),
        _ => None,
    }
}

fn eval_ternary<'a>(
    compare: Option<&SystemValue<'_>>,
    true_value: SystemValue<'a>,
    false_value: SystemValue<'a>,
) -> Option<SystemValue<'a>> {
    if system_value_integer(compare?)? != 0 {
        Some(true_value)
    } else {
        Some(false_value)
    }
}

fn eval_muldiv(
    multiplicand: Option<&SystemValue<'_>>,
    multiplier: Option<&SystemValue<'_>>,
    divisor: Option<&SystemValue<'_>>,
) -> Option<u64> {
    let multiplicand = system_value_integer(multiplicand?)? as i32 as i64;
    let multiplier = system_value_integer(multiplier?)? as i32 as i64;
    let divisor = system_value_integer(divisor?)? as i32 as i64;
    let result = if divisor == 0 {
        -1
    } else {
        multiplicand.saturating_mul(multiplier) / divisor
    };
    Some(u64::from(result as i32 as u32))
}

fn fixed_arctan(y: u64, x: u64) -> u64 {
    let radians = (y as i32 as f64).atan2(x as i32 as f64);
    let degrees = radians * (180.0 / std::f64::consts::PI);
    u64::from((degrees * 65536.0) as i32 as u32)
}

fn fixed_veclen(left: u64, right: u64) -> u64 {
    let left = left as i32 as f64;
    let right = right as i32 as f64;
    u64::from(left.hypot(right) as i32 as u32)
}

fn fixed_trig(value: u64, op: fn(f64) -> f64) -> u64 {
    let radians = (value as i32 as f64) * ((std::f64::consts::PI / 180.0) / 65536.0);
    u64::from((op(radians) * 65536.0) as i32 as u32)
}

fn string_bytes<'value>(value: Option<&'value SystemValue<'_>>) -> Option<&'value [u8]> {
    value?.string_bytes()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn evaluates_fixed_point_vector_ops() {
        let mut stack = vec![SystemValue::Integer(3), SystemValue::Integer(4)];
        assert!(apply_basic_no_operand(0x44, &mut stack));
        assert_eq!(stack, vec![SystemValue::Integer(5)]);

        let mut stack = vec![SystemValue::Integer(0), SystemValue::Integer(1)];
        assert!(apply_basic_no_operand(0x43, &mut stack));
        assert_eq!(stack, vec![SystemValue::Integer(0)]);
    }

    #[test]
    fn evaluates_boolean_binary_ops_with_bgi_ordering() {
        assert_eq!(eval_basic_binary_integer(0x38, 1, 1), Some(1));
        assert_eq!(eval_basic_binary_integer(0x38, 1, 0), Some(0));
        assert_eq!(eval_basic_binary_integer(0x39, 1, 0), Some(1));
        assert_eq!(eval_basic_binary_integer(0x39, 0, 0), Some(0));
    }
}
